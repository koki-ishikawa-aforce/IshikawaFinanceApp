import { z } from 'zod'
import { ReminderStopReasonSchema, type ReminderStopReason } from './ReminderStopReason'

/**
 * リマインダー継続判定（08g §2「リマインダーの停止を判定する」）
 * @see docs/domain/08g-ul-通知配信.md §2
 *
 * kawasima:
 *   behavior リマインダーの停止を判定する = ユーザーID AND 当月 -> リマインダー継続判定
 *   data リマインダー継続判定 = 継続 OR 停止
 *   data 継続 = 判定日時
 *   data 停止 = 判定日時 AND 停止理由
 *
 * 判定に必要な入力（CSV 取込完了状態・通知機能の有効化状態）は他コンテキストが供給する。
 * 本モジュールは供給された状態から停止可否を決めるだけの純粋関数で、I/O を持たない。
 */

/**
 * リマインダーの配信開始日（当月 5 日以降。08g §2「事前: 当月 5 日以降」）。
 *
 * スケジューラの起動日設定と判定側でこの値が二重定義になると、
 * 「起動はするが常に対象外」という無言の停止を招くため、ドメインの単一ソースとして置く。
 */
export const REMINDER_START_DAY_OF_MONTH = 5

export const ReminderContinuationJudgmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('continue'), judgedAt: z.date() }),
  z.object({
    kind: z.literal('stop'),
    judgedAt: z.date(),
    stopReason: ReminderStopReasonSchema,
  }),
])
export type ReminderContinuationJudgment = z.infer<typeof ReminderContinuationJudgmentSchema>

export interface ReminderJudgmentInput {
  /** 対象月の CSV 取込が完了しているか（transaction-import の CsvImportStatusQuery 由来） */
  csvImportCompleted: boolean
  /** 通知機能が有効化済みか（onboarding-auth の LINE 運用設定由来） */
  notificationEnabled: boolean
}

/**
 * リマインダーを継続すべきかを判定する。
 *
 * 停止理由の優先順は「CSV 取込完了 → 通知機能無効化中」。取込完了はその月のリマインダーが
 * 役目を終えた正常な終了であり、通知機能の無効化より状態として確定的なため、
 * 両方成立する場合は取込完了を理由として記録する。
 */
export function judgeReminderContinuation(
  input: ReminderJudgmentInput,
  judgedAt: Date,
): ReminderContinuationJudgment {
  const stopReason: ReminderStopReason | undefined = input.csvImportCompleted
    ? 'csv_import_completed'
    : !input.notificationEnabled
      ? 'notification_disabled'
      : undefined

  return ReminderContinuationJudgmentSchema.parse(
    stopReason === undefined
      ? { kind: 'continue', judgedAt }
      : { kind: 'stop', judgedAt, stopReason },
  )
}

/**
 * 世帯の全メンバーの判定から、共通トークルームへのリマインダーを継続すべきかを決める。
 *
 * 配信先は世帯にひとつの共通トークルームで、宛先を個人単位に分けられない。片方だけが
 * 取込済みでも、もう片方への催促はまだ必要なため「1 人でも継続なら継続」とする。
 * 判定が 1 件も無い場合（メンバー未登録）は停止扱い（催促する相手が居ない）。
 */
export function combineReminderJudgments(
  judgments: readonly ReminderContinuationJudgment[],
  judgedAt: Date,
): ReminderContinuationJudgment {
  const firstContinue = judgments.find(j => j.kind === 'continue')
  if (firstContinue !== undefined) return firstContinue

  const firstStop = judgments.find(j => j.kind === 'stop')
  return (
    firstStop ??
    judgeReminderContinuation({ csvImportCompleted: false, notificationEnabled: false }, judgedAt)
  )
}
