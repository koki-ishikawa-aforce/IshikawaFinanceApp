/**
 * 不認定分振替
 * @see docs/domain/08c-ul-家計分析.md §1
 * @see docs/domain/08e-ul-経費精算.md §1
 *
 * 経費精算（不認定分の確定側）と家計分析（最終確定月次レポートの保持側）の共有カーネル語彙。
 * Phase 5 M-A で household-analysis から shared へ移設し、`transferTarget` を
 * PersonalExpenseClassSchema へ強化（エクスポート名は不変）。
 */
import { z } from 'zod'
import { TransactionIdSchema } from '../ids'
import { MoneySchema } from './Money'
import { PersonalExpenseClassSchema } from './PersonalExpenseClass'

export const UnapprovedExpenseTransferSchema = z.object({
  originalBusinessExpenseTransactionId: TransactionIdSchema,
  transferTarget: PersonalExpenseClassSchema,
  transferAmount: MoneySchema,
  transferredAt: z.date(),
})
export type UnapprovedExpenseTransfer = z.infer<typeof UnapprovedExpenseTransferSchema>
