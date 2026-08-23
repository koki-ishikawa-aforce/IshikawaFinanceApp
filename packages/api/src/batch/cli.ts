/**
 * バッチの手動起動（#416）
 *
 * EventBridge を用意せずに、ローカルから同じジョブを 1 回ぶん動かすための入口。
 * ハンドラーを組み立てて呼ぶ（ジョブを直に呼ばない）ことで、イベントの読み取り・上限時間・
 * 失敗の翻訳まで本番と同じ経路を通る — 手元で通ったのに Lambda では通らない、を避ける。
 *
 * 定時起動との違いは依存の合成だけで、`DATABASE_URL` が無ければインメモリのモックで動かす
 * （データを用意せずに起動口の疎通だけ確かめられるようにする）。定時起動側は同じ落ち方を
 * 禁じている（`deps.ts` 参照）。
 *
 * 使い方は `packages/api/README.md`「バッチの手動起動」を参照。
 */
import {
  createCsvImportReminderHandler,
  createDailyMailImportHandler,
  createMonthlyExpenseCycleStartHandler,
  batchTimeoutMsFromEnv,
  type ScheduledBatchHandler,
  type ScheduledBatchHandlerOptions,
} from './handlers.js'
import { loadLocalBatchDeps } from './deps.js'

function localOptions(): ScheduledBatchHandlerOptions {
  return {
    loadDeps: loadLocalBatchDeps,
    timeoutMs: batchTimeoutMsFromEnv(process.env['BATCH_TIMEOUT_MS']),
  }
}

/** ジョブ名（コマンドの第 1 引数）→ ハンドラー */
export function createLocalHandlers(): Record<string, ScheduledBatchHandler> {
  const options = localOptions()
  return {
    daily: createDailyMailImportHandler(options),
    monthly: createMonthlyExpenseCycleStartHandler(options),
    'csv-reminder': createCsvImportReminderHandler(options),
  }
}

export const LOCAL_JOB_NAMES = ['daily', 'monthly', 'csv-reminder'] as const

const USAGE = `使い方: run-local <${LOCAL_JOB_NAMES.join('|')}> [--at=<ISO8601>] [--target-year-month=<YYYY-MM>] [--scan-days=<正の整数>]`

/** `--key=value` 形式の引数を読む（値の妥当性はイベントの読み取り側が検査する） */
function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return args.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
}

/**
 * 終了コード: 0 = 成功 / 1 = ジョブの失敗 / 2 = 呼び出し方の誤り。
 *
 * 引数の書き間違い（未知のジョブ名・読めない時刻や日数）は 2 に寄せる。ジョブが動いた末の
 * 失敗（1）と混ざると、運用者が「バッチが落ちた」と読み違えるため。
 */
export async function runBatchCli(argv: string[]): Promise<number> {
  const [jobName = '', ...args] = argv
  const handler = createLocalHandlers()[jobName]
  if (handler === undefined) {
    console.error(USAGE)
    return 2
  }

  const at = readFlag(args, 'at')
  const targetYearMonth = readFlag(args, 'target-year-month')
  const scanDays = readFlag(args, 'scan-days')

  // EventBridge が渡すイベントと同じ形に組み立てる（`detail` は知らないキーを弾く）
  const event = {
    ...(at === undefined ? {} : { time: at }),
    detail: {
      ...(targetYearMonth === undefined ? {} : { targetYearMonth }),
      ...(scanDays === undefined ? {} : { scanDays: Number(scanDays) }),
    },
  }

  try {
    const summary = await handler(event)
    console.log(JSON.stringify(summary, null, 2))
    return 0
  } catch (e) {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    if (e instanceof Error && e.name === 'InvalidScheduledBatchEventError') {
      console.error(USAGE)
      return 2
    }
    return 1
  }
}
