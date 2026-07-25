/**
 * LINE 運用設定（友達追加 × 通知機能有効化）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * 改訂（2026-07-24・判断セッション / #73、OQ-55 ①）: 共通トークルーム参加状態は
 * 「世帯にひとつの事実」（join Webhook が userId を含まない）のため per-user の本 VO から
 * 分離し、世帯レベルの `SharedTalkRoom` 集約へ移した。
 * 改訂（2026-07-25・判断セッション / #334）: 通知機能有効化済みが持っていた共通トークルームID
 * を廃止し、有効化日時のみを保持する。トークルームID は世帯レベルの `SharedTalkRoom` が唯一の
 * 正であり、per-user に複製すると招待し直し（トークルーム作り直し）で古い ID が残り、誰も
 * 検知できないまま配信先の判断材料に混ざるため。
 *
 * 不変条件:
 *  - 通知機能有効化済み ⇒ 友達追加済み
 *
 * 「通知機能有効化済み ⇒ 世帯の共通トークルーム参加済み」は AppUser と SharedTalkRoom の
 * 2 集約にまたがるため、本 VO ではなく `services/activateNotification.ts` が強制する。
 */
import { z } from 'zod'

export const FriendAddStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_added') }),
  z.object({ kind: z.literal('added'), followWebhookReceivedAt: z.date() }),
])
export type FriendAddState = z.infer<typeof FriendAddStateSchema>

export const NotificationActivationStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_activated') }),
  z.object({
    kind: z.literal('activated'),
    activatedAt: z.date(),
  }),
])
export type NotificationActivationState = z.infer<typeof NotificationActivationStateSchema>

export const LineOperationSettingsSchema = z
  .object({
    friendAdd: FriendAddStateSchema,
    notificationActivation: NotificationActivationStateSchema,
  })
  .superRefine((settings, ctx) => {
    if (
      settings.notificationActivation.kind === 'activated' &&
      settings.friendAdd.kind !== 'added'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '通知機能有効化済みなら友達追加済みでなければならない',
        path: ['friendAdd'],
      })
    }
  })
export type LineOperationSettings = z.infer<typeof LineOperationSettingsSchema>
