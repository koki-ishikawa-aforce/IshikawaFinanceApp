/**
 * NISA 口座の表示用証券会社名（per-user 編集可、Phase 3.5 追加）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * kawasima: data 証券会社名 = SBI証券 OR 楽天証券 OR その他証券会社
 */
import { z } from 'zod'

export const BrokerageNameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sbi') }),
  z.object({ kind: z.literal('rakuten') }),
  z.object({ kind: z.literal('other'), customName: z.string().min(1).max(50) }),
])
export type BrokerageName = z.infer<typeof BrokerageNameSchema>

export function brokerageNameToDisplay(name: BrokerageName): string {
  switch (name.kind) {
    case 'sbi':
      return 'SBI証券'
    case 'rakuten':
      return '楽天証券'
    case 'other':
      return name.customName
  }
}
