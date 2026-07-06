import { z } from 'zod'

/**
 * 配信内容（プレーンテキスト OR Flex Message）
 * @see docs/domain/08g-ul-通知配信.md §1
 *
 * OQ-39: Flex Message のサイズ制限（Honey/Darling 別リンク × 2 セット = 4 リンクが
 * 収まるか）の検証は adapter 層（Phase 5 M-B/M-C）へ先送り。
 * 本型では payload をプレーン文字列としてのみモデル化する。
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
    linkUrl: z.string(),
  }),
])
export type DeliveryContent = z.infer<typeof DeliveryContentSchema>
