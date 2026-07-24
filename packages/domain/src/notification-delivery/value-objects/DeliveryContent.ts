import { z } from 'zod'

/**
 * 配信内容（プレーンテキスト OR Flex Message）
 * @see docs/domain/08g-ul-通知配信.md §1
 *
 * OQ-39 は解決済み（2026-07-24）: 4 リンク同梱の CSV取込リマインダーで 1,895 B と
 * サイズ上限（50KB）に対し十分な余裕があり、簡略版へのフォールバックは不要と確認した。
 * サイズ制約が型に現れないため、本型では payload をプレーン文字列としてモデル化する。
 */
export const DeliveryContentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('plain_text'),
    textBody: z.string().min(1),
    linkUrl: z.string().optional(),
  }),
  z.object({
    kind: z.literal('flex_message'),
    flexPayloadJson: z.string().min(1),
    linkUrl: z.string().min(1),
  }),
])
export type DeliveryContent = z.infer<typeof DeliveryContentSchema>
