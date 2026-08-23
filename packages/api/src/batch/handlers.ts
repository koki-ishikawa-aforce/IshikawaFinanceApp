/**
 * バッチの Lambda ハンドラー（#416）
 *
 * EventBridge のスケジュールが Lambda を起動し、この関数がジョブ 1 回ぶんを実行する
 * （01-overview.md §6.5）。スケジュールルールの定義・IaC・デプロイ設定は本モジュールの
 * 対象外（#35 / #56 / #57）で、ここにあるのは「呼ばれたら動くコード」まで。
 *
 * 3 つのハンドラーを分けているのは、起動時刻をそれぞれ別に決められるようにするため。
 * メール取込は日付が変わってすぐ（前日ぶんの通知が出揃ってから）、CSV 取込リマインダーは
 * 人が読む時間帯に届いてほしく、月次サイクルの開始は月初に 1 度だけ動けばよい。
 *
 * 失敗したときは例外を投げる（握りつぶさない）。Lambda はこれを失敗として記録し、
 * EventBridge のリトライ・監視の対象になる。逆に、ここで例外を飲み込むと
 * 「毎日成功しているのに何も取り込まれていない」状態が続いても誰も気づけない。
 *
 * 上限時間: バッチには応答を待つ相手が居らず、外部 API がいつまでも返さない場合に
 * そのまま待ち続けてしまう。Lambda 側のタイムアウトで打ち切られると、その回に何が
 * 起きていたのかがログに残らない。上限に達した時点でこちら側から打ち切り、何のジョブが
 * どれだけの時間で止まったかを記録してから失敗させる（そこまでに済んだぶんの結末は
 * ジョブ側が 1 件ずつログに出している）。
 *
 * 打ち切りの限界: `withTimeout` は待つのをやめるだけで、進行中の処理そのものは止められない。
 * Lambda の実行環境は関数の終了とともに凍結されるが、次の起動で解凍されると残りの処理が
 * 続きから動く（やり直しではなく継続）。また、月次サイクル開始が「保存済み・イベント未発行」の
 * 位置で打ち切られた場合、次回は `already_started` になり開始イベントは出し直されない
 * （#484 の既知の制約）。
 */
import type { AppDeps } from '../composition-root.js'
import { createCsvImportReminderRunnerFromDeps } from '../notification/csv-import-reminder.js'
import { withTimeout } from '../with-timeout.js'
import { loadBatchDeps } from './deps.js'
import {
  runCsvImportReminderJob,
  runDailyMailImportJob,
  runMonthlyExpenseCycleStartJob,
  type ScheduledJobName,
  type ScheduledJobSummary,
} from './jobs.js'
import { readScheduledBatchEvent, type ScheduledBatchInput } from './scheduled-event.js'

/** 上限時間の既定（10 分）。`BATCH_TIMEOUT_MS` で上書きできる */
export const DEFAULT_BATCH_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Lambda 側のタイムアウトより手前で打ち切るための余裕。
 * 打ち切り後にログを書き出すぶんの時間を残す（Lambda に殺されるとログが残らない）。
 */
const TIMEOUT_MARGIN_MS = 5_000

/**
 * Lambda の実行コンテキストのうち、ここで使う部分だけの型。
 * `aws-lambda` の型パッケージを依存に加えずに済ませるため、必要な 1 メソッドだけを構造で受ける。
 */
export interface LambdaContextLike {
  getRemainingTimeInMillis?: (() => number) | undefined
}

export type ScheduledBatchHandler = (
  event: unknown,
  context?: LambdaContextLike,
) => Promise<ScheduledJobSummary>

export interface ScheduledBatchHandlerOptions {
  loadDeps: () => Promise<AppDeps>
  /** 上限時間（省略時 `DEFAULT_BATCH_TIMEOUT_MS`） */
  timeoutMs?: number | undefined
  /** 基準時刻の既定値（イベントに `time` が無いとき）。テストから固定するために差し込める */
  now?: (() => Date) | undefined
}

/**
 * 上限時間を決める。Lambda の残り時間が分かる場合はそれより手前に寄せる
 * （設定した上限が Lambda のタイムアウトより長いと、こちらの打ち切りが働く前に殺される）。
 * 残りが余裕を下回っていても 1 秒は待つ — 0 以下にすると起動直後に必ず打ち切られる。
 */
function resolveTimeoutMs(
  configured: number | undefined,
  context: LambdaContextLike | undefined,
): number {
  const limit = configured ?? DEFAULT_BATCH_TIMEOUT_MS
  const remaining = context?.getRemainingTimeInMillis?.()
  if (remaining === undefined) return limit
  return Math.max(1_000, Math.min(limit, remaining - TIMEOUT_MARGIN_MS))
}

function createHandler(
  job: ScheduledJobName,
  options: ScheduledBatchHandlerOptions,
  invoke: (deps: AppDeps, input: ScheduledBatchInput) => Promise<ScheduledJobSummary>,
): ScheduledBatchHandler {
  return async (event, context) => {
    let input: ScheduledBatchInput
    try {
      input = readScheduledBatchEvent(event, options.now)
    } catch (e) {
      // 起動イベントの読み取りは開始ログより前に起きる。どのジョブの起動が弾かれたのかが
      // 分からないと、3 ハンドラーが同居する実行環境では原因を辿れない
      console.error(
        `[batch] ${job} の起動イベントを読めなかった（${e instanceof Error ? e.name : 'unknown'}）`,
      )
      throw e
    }
    const timeoutMs = resolveTimeoutMs(options.timeoutMs, context)
    console.info(
      `[batch] ${job} を開始する（at=${input.at.toISOString()}, timeoutMs=${timeoutMs}）`,
    )
    try {
      return await withTimeout((async () => invoke(await options.loadDeps(), input))(), timeoutMs)
    } catch (e) {
      if (e instanceof Error && e.name === 'TimeoutError') {
        console.error(
          `[batch] ${job} が上限時間に達したため打ち切った（timeoutMs=${timeoutMs}, ` +
            `at=${input.at.toISOString()}）— 済んだぶんの結末は上の行に出ている`,
        )
      }
      throw e
    }
  }
}

/** 日次: メール取込（#414 のワーカーを世帯ぶん実行する） */
export function createDailyMailImportHandler(
  options: ScheduledBatchHandlerOptions,
): ScheduledBatchHandler {
  return createHandler('daily-mail-import', options, (deps, input) =>
    runDailyMailImportJob(deps, {
      at: input.at,
      ...(input.overrides.scanDays === undefined ? {} : { scanDays: input.overrides.scanDays }),
    }),
  )
}

/** 月次: 経費サイクルの開始（#413 の開始処理を世帯ぶん実行する） */
export function createMonthlyExpenseCycleStartHandler(
  options: ScheduledBatchHandlerOptions,
): ScheduledBatchHandler {
  return createHandler('monthly-expense-cycle-start', options, (deps, input) =>
    runMonthlyExpenseCycleStartJob(deps, {
      at: input.at,
      ...(input.overrides.targetYearMonth === undefined
        ? {}
        : { targetYearMonth: input.overrides.targetYearMonth }),
    }),
  )
}

/** 日次: CSV 取込リマインダー（#389 の配信処理を毎月 5 日から取込完了まで実行する） */
export function createCsvImportReminderHandler(
  options: ScheduledBatchHandlerOptions,
): ScheduledBatchHandler {
  return createHandler('csv-import-reminder', options, (deps, input) =>
    runCsvImportReminderJob(
      { csvImportReminderRunner: createCsvImportReminderRunnerFromDeps(deps) },
      {
        at: input.at,
        ...(input.overrides.targetYearMonth === undefined
          ? {}
          : { targetYearMonth: input.overrides.targetYearMonth }),
      },
    ),
  )
}

/**
 * `BATCH_TIMEOUT_MS` → 正の整数（不正値は既定値）。
 *
 * 依存の合成に渡す設定ではない（`CompositionEnv` に載せない）ため、ここで直接読む。
 * 不正値を黙って既定値に落とすと、設定したつもりの上限が効かないまま気づけないため警告を出す。
 */
export function batchTimeoutMsFromEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) return parsed
  console.warn(
    `BATCH_TIMEOUT_MS が正の整数ではないため既定値（${DEFAULT_BATCH_TIMEOUT_MS}ms）を使う`,
  )
  return undefined
}

function defaultOptions(): ScheduledBatchHandlerOptions {
  return {
    loadDeps: loadBatchDeps,
    timeoutMs: batchTimeoutMsFromEnv(process.env['BATCH_TIMEOUT_MS']),
  }
}

/**
 * EventBridge から呼ばれるハンドラーの実体。
 * Lambda のハンドラー指定は `dist/batch/handlers.<名前>` を指す。
 */
export const dailyMailImportHandler = createDailyMailImportHandler(defaultOptions())
export const monthlyExpenseCycleStartHandler =
  createMonthlyExpenseCycleStartHandler(defaultOptions())
export const csvImportReminderHandler = createCsvImportReminderHandler(defaultOptions())
