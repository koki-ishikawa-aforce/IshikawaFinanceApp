/**
 * 世帯通知有効化記録（世帯レベル、08f §1「世帯通知有効化記録」）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1 §2
 * @see docs/domain/09-aggregates.md #14c
 * @see docs/domain/03-open-questions.md OQ-55 ①（改訂 2026-08-23 / #447）
 *
 * 「世帯の通知機能を有効化し、テストメッセージの送信を依頼した」という事実を世帯にひとつだけ
 * 記録する。per-user の 通知機能有効化状態 は #334 の整理どおり残るが、「もう送ったか」の判断は
 * per-user の状態の組み合わせからの推測ではなく本記録で行う（#447）。
 *
 * 推測に頼ると「有効化の保存は成功したが送信の依頼で失敗した」回を「もう送った」と誤認し、
 * テストメッセージがその世帯へ二度と送られない。本記録は**送信の依頼が成功して初めて書く**ため、
 * 失敗した回は次の発火の起点でやり直せる。
 *
 * 世帯は夫婦 2 人固定でありシングルトン（OQ-53 ②）。識別子を持たないため、Repository は
 * 引数なしで唯一の記録を読み書きする（`SharedTalkRoom` と同じ）。
 */
import { z } from 'zod'

export const HouseholdNotificationActivationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_activated') }),
  z.object({ kind: z.literal('activated'), activatedAt: z.date() }),
])
export type HouseholdNotificationActivation = z.infer<typeof HouseholdNotificationActivationSchema>

/** 有効化済みの記録（永続化の対象はこの状態のみ） */
export type ActivatedHouseholdNotification = Extract<
  HouseholdNotificationActivation,
  { kind: 'activated' }
>

/** 未有効化（記録が存在しない状態と同義） */
export const NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION: HouseholdNotificationActivation = {
  kind: 'not_activated',
}

/**
 * 世帯の通知機能有効化を記録する（冪等: 有効化済みなら有効化日時を上書きしない）。
 *
 * 有効化日時は下流（テストメッセージ配信）が冪等性キーに使う。再発火のたびに書き換わると
 * 同じテストメッセージが何通も届くため、最初に記録した日時を最終とする。
 */
export function recordHouseholdNotificationActivated(
  activation: HouseholdNotificationActivation,
  activatedAt: Date,
): ActivatedHouseholdNotification {
  if (activation.kind === 'activated') return activation
  return HouseholdNotificationActivationSchema.parse({
    kind: 'activated',
    activatedAt,
  }) as ActivatedHouseholdNotification
}

/**
 * 世帯として通知機能を有効化済みか（= テストメッセージの送信を依頼済みとみなせる状態か）。
 */
export function isHouseholdNotificationActivated(
  activation: HouseholdNotificationActivation,
): boolean {
  return activation.kind === 'activated'
}
