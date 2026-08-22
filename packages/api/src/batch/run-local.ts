/**
 * バッチの手動起動（#416）
 *
 * EventBridge を用意せずに、ローカルから同じハンドラーを呼ぶための入口。
 * ハンドラーを直接呼ぶ（ジョブを直に呼ばない）ことで、イベントの読み取り・上限時間・
 * 失敗の翻訳まで本番と同じ経路を通る — 手元で通ったのに Lambda では通らない、を避ける。
 *
 * 使い方は `packages/api/README.md`「バッチの手動起動」を参照。
 */
import 'dotenv/config'
import {
  csvImportReminderHandler,
  dailyMailImportHandler,
  monthlyExpenseCycleStartHandler,
  type ScheduledBatchHandler,
} from './handlers.js'

const HANDLERS: Record<string, ScheduledBatchHandler> = {
  daily: dailyMailImportHandler,
  monthly: monthlyExpenseCycleStartHandler,
  'csv-reminder': csvImportReminderHandler,
}

const USAGE = `使い方: run-local <${Object.keys(HANDLERS).join('|')}> [--at=<ISO8601>] [--target-year-month=<YYYY-MM>] [--scan-days=<正の整数>]`

/** `--key=value` 形式の引数を読む（値の妥当性はイベントの読み取り側が検査する） */
function readFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  return args.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
}

/** 終了コード: 0 = 成功 / 1 = ジョブの失敗 / 2 = 呼び出し方の誤り */
async function main(argv: string[]): Promise<number> {
  const [jobName = '', ...args] = argv
  const handler = HANDLERS[jobName]
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
    return 1
  }
}

process.exit(await main(process.argv.slice(2)))
