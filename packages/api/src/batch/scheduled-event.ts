/**
 * スケジュール起動イベントの読み取り（#416）
 *
 * バッチは EventBridge のスケジュールから起動する（01-overview.md §6.5）。EventBridge が
 * 渡してくるイベントのうちバッチが使うのは 2 つだけ:
 *
 *  - `time`: 発火時刻。これを「いつのぶんの処理か」の基準に使う。実行機のクロックではなく
 *    イベント側の時刻を採るのは、起動が遅れた回・手で流し直した回でも同じ結論になるようにするため
 *  - `detail`: 対象を明示するときの上書き（対象年月・さかのぼり日数）。EventBridge の
 *    ターゲット入力に JSON を置くと運用中に値を変えられる（OQ-31 のさかのぼり日数など）
 *
 * 上書きの書式が違う（型が違う・知らないキーがある）ときは黙って既定値に落とさず失敗させる。
 * 落としてしまうと、意図した対象と違う月・違う期間を処理した結果が「成功」として残る。
 */
import { z } from 'zod'
import { YearMonthSchema, type YearMonth } from '@warimaru/domain'

/**
 * スケジュール側から明示する対象。
 * 省略時はイベントの発火時刻から導出する（各ジョブの既定値）。
 */
const ScheduledBatchOverridesSchema = z
  .object({
    /** 対象年月（月次サイクル開始・CSV 取込リマインダー） */
    targetYearMonth: YearMonthSchema.optional(),
    /** さかのぼって再走査する日数（日次メール取込。論点22 / OQ-31） */
    scanDays: z.number().int().positive().optional(),
  })
  .strict()

/**
 * EventBridge のスケジュール起動イベント。
 * `time` / `detail` 以外のフィールド（id・source・resources など）は読まないため素通しする。
 */
const ScheduledBatchEventSchema = z
  .object({
    // EventBridge は UTC（末尾 Z）で渡してくるが、手動起動では JST 表記のほうが書きやすいため
    // オフセット付きも受ける
    time: z.string().datetime({ offset: true }).optional(),
    detail: ScheduledBatchOverridesSchema.optional(),
  })
  .passthrough()

export interface ScheduledBatchOverrides {
  targetYearMonth?: YearMonth | undefined
  scanDays?: number | undefined
}

export interface ScheduledBatchInput {
  /** 処理の基準時刻（イベントの `time`。無ければ実行時刻） */
  at: Date
  overrides: ScheduledBatchOverrides
}

/**
 * イベントを読み、基準時刻と上書きを取り出す。
 *
 * 書式が不正なら例外を投げる（エラーメッセージにはキー名と理由だけを載せ、値そのものは
 * 載せない。EventBridge のターゲット入力は運用者が自由に書けるため、何が入っていても
 * ログへ流さない）。
 */
export function readScheduledBatchEvent(
  event: unknown,
  now: () => Date = () => new Date(),
): ScheduledBatchInput {
  const parsed = ScheduledBatchEventSchema.safeParse(event ?? {})
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.code}`)
      .join(', ')
    const error = new Error(`スケジュール起動イベントの書式が不正（${fields}）`)
    error.name = 'InvalidScheduledBatchEventError'
    throw error
  }

  const { time, detail } = parsed.data
  const at = time === undefined ? now() : new Date(time)
  return {
    at,
    overrides: {
      ...(detail?.targetYearMonth === undefined ? {} : { targetYearMonth: detail.targetYearMonth }),
      ...(detail?.scanDays === undefined ? {} : { scanDays: detail.scanDays }),
    },
  }
}
