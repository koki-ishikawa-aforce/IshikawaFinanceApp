/**
 * LINE 運用設定（友達追加 × トークルーム参加 × 通知機能有効化）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * 不変条件: 通知機能有効化済み ⇒ トークルーム参加済み かつ 友達追加済み
 */
import { z } from 'zod'
import { TalkRoomIdSchema } from '../../shared/ids'

export const FriendAddStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_added') }),
  z.object({ kind: z.literal('added'), followWebhookReceivedAt: z.date() }),
])
export type FriendAddState = z.infer<typeof FriendAddStateSchema>

export const TalkRoomJoinStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_joined') }),
  z.object({
    kind: z.literal('joined'),
    talkRoomId: TalkRoomIdSchema,
    joinWebhookReceivedAt: z.date(),
  }),
])
export type TalkRoomJoinState = z.infer<typeof TalkRoomJoinStateSchema>

export const NotificationActivationStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_activated') }),
  z.object({
    kind: z.literal('activated'),
    talkRoomId: TalkRoomIdSchema,
    activatedAt: z.date(),
  }),
])
export type NotificationActivationState = z.infer<typeof NotificationActivationStateSchema>

export const LineOperationSettingsSchema = z
  .object({
    friendAdd: FriendAddStateSchema,
    talkRoomJoin: TalkRoomJoinStateSchema,
    notificationActivation: NotificationActivationStateSchema,
  })
  .superRefine((settings, ctx) => {
    if (settings.notificationActivation.kind === 'activated') {
      if (settings.talkRoomJoin.kind !== 'joined') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '通知機能有効化済みならトークルーム参加済みでなければならない',
          path: ['talkRoomJoin'],
        })
      }
      if (settings.friendAdd.kind !== 'added') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '通知機能有効化済みなら友達追加済みでなければならない',
          path: ['friendAdd'],
        })
      }
    }
  })
export type LineOperationSettings = z.infer<typeof LineOperationSettingsSchema>
