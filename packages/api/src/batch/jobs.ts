/**
 * 定時起動するバッチジョブ（#416）
 *
 * 日次・月次に動く処理はそれぞれ別の Issue で実装済みで、ここにあるのは「スケジューラから
 * 呼ぶときの手続き」だけ — 何を渡すか、結末をどう記録するか、どこから先を失敗として扱うか。
 * 処理そのものは持たないため、取込やサイクル開始の規則をここに書き足してはいけない。
 *
 *  - 日次メール取込（#414 の `runDailyMailImportForHousehold`）
 *  - 月次経費サイクルの開始（#413 の `startMonthlyExpenseCyclesForHousehold`）
 *  - CSV 取込リマインダー（#389 の `CsvImportReminderRunner`。毎月 5 日から取込完了まで日次）
 *
 * 失敗の扱い: どのジョブも「1 人の失敗で他方を巻き込まない」ために、結末を戻り値で返す設計に
 * なっている。バッチには結果を見る人がその場に居ないため、戻り値のまま捨てると「その日だけ
 * 取り込まれていない」「その月だけ経費が積まれていない」に誰も気づけない。ここで失敗を数え、
 * 1 件でもあれば例外にしてスケジューラ側の失敗（Lambda の失敗 → 監視）へ翻訳する。
 *
 * ログに出すのは役割・件数・エラー種別だけ。ユーザーID（LINE userID）・メール本文・
 * 加盟店名は出さない（個人を辿れる情報をバッチのログに残さない）。
 */
import { jstYearMonthOf, type YearMonth } from '@warimaru/domain'
import {
  runDailyMailImportForHousehold,
  type HouseholdDailyMailImportDeps,
} from '../daily-mail-import.js'
import {
  startMonthlyExpenseCyclesForHousehold,
  type HouseholdMonthlyExpenseCycleStartDeps,
} from '../monthly-expense-cycle-start.js'
import type { CsvImportReminderRunner } from '../notification/csv-import-reminder.js'

export type BatchJobName =
  | 'daily-mail-import'
  | 'monthly-expense-cycle-start'
  | 'csv-import-reminder'

/**
 * ジョブ 1 回ぶんの結末（ログと呼出し元の判定用）。
 * `outcomes` は 1 行 1 件の要約で、役割・件数・エラー種別だけを含む。
 */
export interface BatchJobSummary {
  job: BatchJobName
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
export class BatchJobFailedError extends Error {
  constructor(
    readonly summary: BatchJobSummary,
    readonly failures: string[],
  ) {
    super(`${summary.job} が ${failures.length} 件失敗した（${failures.join(' / ')}）`)
    this.name = 'BatchJobFailedError'
  }
}

function summarize(job: BatchJobName, at: Date, outcomes: string[]): BatchJobSummary {
  return { job, at: at.toISOString(), outcomes }
}

/** 失敗が 1 件でもあれば記録して例外にする。無ければ結末を記録して返す */
function finish(summary: BatchJobSummary, failures: string[]): BatchJobSummary {
  if (failures.length > 0) {
    console.error(
      `[batch] ${summary.job} に失敗を含む（at=${summary.at}, ${summary.outcomes.join(', ')}）`,
    )
    throw new BatchJobFailedError(summary, failures)
  }
  console.info(
    `[batch] ${summary.job} を完了した（at=${summary.at}, ${summary.outcomes.join(', ')}）`,
  )
  return summary
}

/**
 * 日次メール取込（AT-902）。
 *
 * さかのぼり日数を省略するとワーカー既定の 5 日を使う（論点22 / OQ-31）。
 * Gmail 連携が無い・失効しているユーザーの取込失敗も失敗として扱う — その状態が続く限り
 * カード利用が家計簿に出てこないため、毎回黙って成功にすると誰も気づけない。
 */
export async function runDailyMailImportJob(
  deps: HouseholdDailyMailImportDeps,
  params: { at: Date; scanDays?: number | undefined },
): Promise<BatchJobSummary> {
  const outcome = await runDailyMailImportForHousehold(deps, {
    at: params.at,
    ...(params.scanDays === undefined ? {} : { scanDays: params.scanDays }),
  })

  const outcomes: string[] = []
  const failures: string[] = []
  for (const result of outcome.results) {
    if (result.status === 'not_registered') {
      outcomes.push(`role=${result.role} status=not_registered`)
      continue
    }
    if (result.status === 'failed') {
      outcomes.push(`role=${result.role} status=failed error=${result.failureKind}`)
      failures.push(`role=${result.role} error=${result.failureKind}`)
      continue
    }
    if (result.outcome.status === 'failed') {
      outcomes.push(
        `role=${result.role} status=failed kind=${result.outcome.failureKind} ` +
          `retryable=${result.outcome.retryable}`,
      )
      failures.push(`role=${result.role} kind=${result.outcome.failureKind}`)
      continue
    }
    outcomes.push(
      `role=${result.role} status=completed imported=${result.outcome.importedCount} ` +
        `duplicate=${result.outcome.duplicateExcludedCount} failed=${result.outcome.failedCount} ` +
        `other=${result.outcome.otherNotificationCount}`,
    )
  }

  return finish(summarize('daily-mail-import', params.at, outcomes), failures)
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
): Promise<BatchJobSummary> {
  const outcome = await startMonthlyExpenseCyclesForHousehold(deps, {
    at: params.at,
    ...(params.targetYearMonth === undefined ? {} : { targetYearMonth: params.targetYearMonth }),
  })

  const outcomes: string[] = [`targetYearMonth=${outcome.targetYearMonth}`]
  const failures: string[] = []
  for (const result of outcome.results) {
    if (result.status === 'failed') {
      outcomes.push(
        `role=${result.role} status=failed error=${result.failureKind} stage=${result.stage}`,
      )
      failures.push(`role=${result.role} error=${result.failureKind} stage=${result.stage}`)
      continue
    }
    outcomes.push(`role=${result.role} status=${result.status}`)
  }

  return finish(summarize('monthly-expense-cycle-start', params.at, outcomes), failures)
}

/**
 * CSV 取込リマインダーの日次起動（AT-903）。
 *
 * 送信そのものの失敗（`send_failed`）は失敗として数えない。単発の送信失敗はスキップして
 * 翌日の実行で送り直す、というのが配信側の決まり（論点23）で、ここで失敗にすると
 * 「翌日には直る」ものが毎回の異常として上がってしまう。
 * 対象年月の指定違い（`not_current_month`）だけはスケジュール設定の誤りなので失敗にする
 * — 直さない限りリマインダーは二度と届かない。
 */
export async function runCsvImportReminderJob(
  deps: { csvImportReminderRunner: CsvImportReminderRunner },
  params: { at: Date; targetYearMonth?: YearMonth | undefined },
): Promise<BatchJobSummary> {
  const targetMonth = params.targetYearMonth ?? jstYearMonthOf(params.at)
  const outcome = await deps.csvImportReminderRunner.run({ targetMonth, at: params.at })

  const outcomes = [`targetMonth=${targetMonth} outcome=${outcome.kind}`]
  const failures =
    outcome.kind === 'not_current_month'
      ? [`targetMonth=${targetMonth} は当月（${outcome.currentMonth}）ではない`]
      : []

  if (outcome.kind === 'send_failed') {
    console.warn(
      `[batch] CSV 取込リマインダーの送信に失敗した（targetMonth=${targetMonth}）— ` +
        '翌日の実行で送り直す（論点23）',
    )
  }

  return finish(summarize('csv-import-reminder', params.at, outcomes), failures)
}
