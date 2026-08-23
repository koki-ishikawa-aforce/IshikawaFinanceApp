/**
 * 定時起動するジョブ（#416）
 *
 * 日次・月次に動く処理はそれぞれ別の Issue で実装済みで、ここにあるのは「スケジューラから
 * 呼ぶときの手続き」だけ — 何を渡すか、結末をどう記録するか、どこから先を失敗として扱うか。
 * 処理そのものは持たないため、取込やサイクル開始の規則をここに書き足してはいけない。
 *
 *  - 日次メール取込（#414 の `runDailyMailImportForHousehold`）
 *  - 月次経費サイクルの開始（#413 の `startMonthlyExpenseCyclesForHousehold`）
 *  - CSV 取込リマインダー（#389 の `CsvImportReminderRunner`。毎月 5 日から取込完了まで日次）
 *
 * ここでいう「ジョブ」はスケジュールの 1 回ぶんの起動を指す。08a の集約「日次メール取込バッチ」
 * （`DailyMailImportBatch`。ユーザー単位の取込記録）とは別物なので、型名は `ScheduledJob*` に
 * 寄せて語がぶつからないようにしている。
 *
 * 失敗の扱い: どのジョブも「1 人の失敗で他方を巻き込まない」ために、結末を戻り値で返す設計に
 * なっている。バッチには結果を見る人がその場に居ないため、戻り値のまま捨てると「その日だけ
 * 取り込まれていない」「その月だけ経費が積まれていない」に誰も気づけない。ここで失敗を数え、
 * 1 件でもあれば例外にしてスケジューラ側の失敗（Lambda の失敗 → 監視）へ翻訳する。
 *
 * 結末は 1 件ずつその場でログに出す。上限時間で打ち切られた回は最後の要約まで到達しないため、
 * まとめて出すと「誰まで済んで、誰の途中で止まったのか」が残らない。
 *
 * ログに出すのは役割・件数・エラー種別・取込バッチ ID だけ。ユーザーID（LINE userID）・
 * メール本文・加盟店名は出さない（個人を辿れる情報をバッチのログに残さない）。
 */
import type { YearMonth } from '@warimaru/domain'
import {
  runDailyMailImportForHousehold,
  type HouseholdDailyMailImportDeps,
} from '../daily-mail-import.js'
import {
  startMonthlyExpenseCyclesForHousehold,
  type HouseholdMonthlyExpenseCycleStartDeps,
} from '../monthly-expense-cycle-start.js'
import {
  defaultReminderTargetMonth,
  type CsvImportReminderRunner,
} from '../notification/csv-import-reminder.js'

export type ScheduledJobName =
  | 'daily-mail-import'
  | 'monthly-expense-cycle-start'
  | 'csv-import-reminder'

/**
 * ジョブ 1 回ぶんの結末（ログと呼出し元の判定用）。
 * `outcomes` は 1 行 1 件の要約で、役割・件数・エラー種別だけを含む。
 */
export interface ScheduledJobSummary {
  job: ScheduledJobName
  /** 処理の基準時刻（ISO 8601） */
  at: string
  outcomes: string[]
}

/**
 * ジョブの中で失敗した件があったことを表す。
 *
 * 失敗があっても他の対象の処理は最後まで進めてから投げる（片方の失敗でもう片方を
 * 巻き込まない）。スケジューラ（Lambda）はこの例外で失敗として記録される。
 */
export class ScheduledJobFailedError extends Error {
  constructor(
    readonly summary: ScheduledJobSummary,
    readonly failures: string[],
  ) {
    super(`${summary.job} が ${failures.length} 件失敗した（${failures.join(' / ')}）`)
    this.name = 'ScheduledJobFailedError'
  }
}

/**
 * 結末を 1 件ずつ記録する。
 * `notable` は「成功として終わるが人が見るべき」もの（取りこぼしなど）で、警告として残す。
 */
function record(job: ScheduledJobName, outcomes: string[], line: string, notable = false): void {
  outcomes.push(line)
  const message = `[batch] ${job}: ${line}`
  if (notable) console.warn(message)
  else console.info(message)
}

/** 失敗が 1 件でもあれば記録して例外にする。無ければ完了を記録して返す */
function finish(summary: ScheduledJobSummary, failures: string[]): ScheduledJobSummary {
  if (failures.length > 0) {
    console.error(`[batch] ${summary.job} に失敗を含む（at=${summary.at}, ${failures.join(', ')}）`)
    throw new ScheduledJobFailedError(summary, failures)
  }
  console.info(
    `[batch] ${summary.job} を完了した（at=${summary.at}, 結末 ${summary.outcomes.length} 件）`,
  )
  return summary
}

/**
 * 日次メール取込（AT-902）。
 *
 * さかのぼり日数を省略するとワーカー既定の 5 日を使う（論点22 / OQ-31）。
 * Gmail 連携が無い・失効しているユーザーは取込を起動しない（対象外。OQ-57 / #488）が、
 * ジョブとしては失敗に数える — その状態が続く限りカード利用が家計簿に出てこないため、
 * 毎回黙って成功にすると誰も気づけない（#514）。「取込結果に失敗記録を積まない」ことと
 * 「毎日のバッチの成否で気づける」ことは別の層の話で、後者はここが担う。
 */
export async function runDailyMailImportJob(
  deps: HouseholdDailyMailImportDeps,
  params: { at: Date; scanDays?: number | undefined },
): Promise<ScheduledJobSummary> {
  const job: ScheduledJobName = 'daily-mail-import'
  const outcome = await runDailyMailImportForHousehold(deps, {
    at: params.at,
    ...(params.scanDays === undefined ? {} : { scanDays: params.scanDays }),
  })

  const outcomes: string[] = []
  const failures: string[] = []
  for (const result of outcome.results) {
    if (result.status === 'not_registered') {
      // オンボーディング前は取込対象が存在しない（想定内）。失敗には数えない
      record(job, outcomes, `role=${result.role} status=not_registered`)
      continue
    }
    if (result.status === 'not_launched') {
      // 取込は起動していない（対象外）が、再認可されるまでカード利用は家計簿に出てこない。
      // 失敗に数えてジョブ全体を異常にし、気づける状態を保つ（#514 の決定）
      const line = `role=${result.role} status=not_launched reason=${result.reason}`
      record(job, outcomes, line, true)
      failures.push(line)
      continue
    }
    if (result.status === 'failed') {
      const line = `role=${result.role} status=failed error=${result.failureKind}`
      record(job, outcomes, line, true)
      failures.push(line)
      continue
    }
    // 取込バッチ ID はログに出してよい識別子（08a。個人を辿れる情報を含まない）。
    // ジョブのログから取込記録・ワーカー側のログへ辿れるようにする
    const batchRef = `importBatchId=${result.outcome.importBatchId}`
    if (result.outcome.status === 'failed') {
      const line =
        `role=${result.role} status=failed kind=${result.outcome.failureKind} ` +
        `retryable=${result.outcome.retryable} ${batchRef}`
      record(job, outcomes, line, true)
      failures.push(line)
      continue
    }
    record(
      job,
      outcomes,
      `role=${result.role} status=completed imported=${result.outcome.importedCount} ` +
        `duplicate=${result.outcome.duplicateExcludedCount} failed=${result.outcome.failedCount} ` +
        `other=${result.outcome.otherNotificationCount} ${batchRef}`,
      // パースできなかったメールは取引候補にならず、翌日の再走査でも同じく失敗する。
      // その取引は家計簿に載らないまま（金額の取りこぼし）になるため、
      // 成功として終わる回でも件数が 0 でなければ人が見るべき行として残す
      result.outcome.failedCount > 0,
    )
  }

  return finish({ job, at: params.at.toISOString(), outcomes }, failures)
}

/**
 * 月次経費サイクルの開始（AT-905）。
 *
 * 対象年月を省略した場合の既定（起動時刻から JST 暦の当月）は適用モジュール側に置いてある。
 * 月初 00:0x JST は UTC ではまだ前月のため、ここで月を計算し直さない（#413 の申し送り）。
 */
export async function runMonthlyExpenseCycleStartJob(
  deps: HouseholdMonthlyExpenseCycleStartDeps,
  params: { at: Date; targetYearMonth?: YearMonth | undefined },
): Promise<ScheduledJobSummary> {
  const job: ScheduledJobName = 'monthly-expense-cycle-start'
  const outcome = await startMonthlyExpenseCyclesForHousehold(deps, {
    at: params.at,
    ...(params.targetYearMonth === undefined ? {} : { targetYearMonth: params.targetYearMonth }),
  })

  const outcomes: string[] = []
  const failures: string[] = []
  record(job, outcomes, `targetYearMonth=${outcome.targetYearMonth}`)
  for (const result of outcome.results) {
    if (result.status === 'failed') {
      const line = `role=${result.role} status=failed error=${result.failureKind} stage=${result.stage}`
      record(job, outcomes, line, true)
      failures.push(line)
      continue
    }
    record(job, outcomes, `role=${result.role} status=${result.status}`)
  }

  return finish({ job, at: params.at.toISOString(), outcomes }, failures)
}

/**
 * CSV 取込リマインダーの日次起動（AT-903）。
 *
 * 送信そのものの失敗（`send_failed`）は失敗として数えない。単発の送信失敗はスキップして
 * 翌日の実行で送り直す、というのが配信側の決まり（論点23）で、ここで失敗にすると
 * 「翌日には直る」ものが毎回の異常として上がってしまう（月末最終日の失敗だけは翌日が
 * 対象外の月になるため送り直されない。その月のリマインダーは 1 通落ちる）。
 * 対象年月の指定違い（`not_current_month`）だけはスケジュール設定の誤りなので失敗にする
 * — 直さない限りリマインダーは二度と届かない。
 *
 * 配信されなかった結末（未参加・メンバー未登録・送信失敗）は配信側が既に警告・エラーとして
 * 記録しているため、ここでは要約に載せるだけにする（同じ事実を二重に出さない）。
 */
export async function runCsvImportReminderJob(
  deps: { csvImportReminderRunner: CsvImportReminderRunner },
  params: { at: Date; targetYearMonth?: YearMonth | undefined },
): Promise<ScheduledJobSummary> {
  const job: ScheduledJobName = 'csv-import-reminder'
  const targetMonth = params.targetYearMonth ?? defaultReminderTargetMonth(params.at)
  const outcome = await deps.csvImportReminderRunner.run({ targetMonth, at: params.at })

  const outcomes: string[] = []
  const failures: string[] = []
  const line = `targetMonth=${targetMonth} outcome=${outcome.kind}`
  if (outcome.kind === 'not_current_month') {
    record(job, outcomes, line, true)
    failures.push(`targetMonth=${targetMonth} は当月（${outcome.currentMonth}）ではない`)
  } else {
    record(job, outcomes, line)
  }

  return finish({ job, at: params.at.toISOString(), outcomes }, failures)
}
