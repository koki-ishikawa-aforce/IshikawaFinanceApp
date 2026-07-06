/**
 * 初期残高登録参照（残高・資産推移管理への ID 参照群）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 */
import { z } from 'zod'
import { AccountIdSchema } from '../../shared/ids'

export const InitialBalanceRegistrationRefSchema = z.object({
  smbcAccountId: AccountIdSchema,
  otherSavingsAccountId: AccountIdSchema,
  nisaAccountId: AccountIdSchema,
})
export type InitialBalanceRegistrationRef = z.infer<typeof InitialBalanceRegistrationRefSchema>
