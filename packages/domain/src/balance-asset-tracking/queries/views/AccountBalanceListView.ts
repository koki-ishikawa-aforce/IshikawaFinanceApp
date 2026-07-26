import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { AccountIdSchema } from '../../../shared/ids'

export const AccountBalanceItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('smbc_bank'),
    accountId: AccountIdSchema,
    displayName: z.literal('三井住友銀行'),
    currentBalance: MoneySchema,
    lastUpdatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('mitsui_sumitomo_card'),
    accountId: AccountIdSchema,
    displayName: z.literal('三井住友カード'),
    currentMonthUnpaidTotal: MoneySchema,
    lastSettledAt: z.date().nullable(),
  }),
  // 鮮度（経過日数・鮮度状態）は本コンテキストの責務ではない。08d L244 のとおり
  // 最終更新日時のみを供給し、閾値判定は家計分析の `BalanceFreshnessListView` が担う
  z.object({
    kind: z.literal('other_savings'),
    accountId: AccountIdSchema,
    displayName: z.string(),
    currentBalance: MoneySchema,
    lastUpdatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('nisa'),
    accountId: AccountIdSchema,
    displayName: z.string(),
    currentAccumulated: MoneySchema,
    lastUpdatedAt: z.date(),
  }),
])
export type AccountBalanceItem = z.infer<typeof AccountBalanceItemSchema>

export const AccountBalanceListViewSchema = z.object({
  items: z.array(AccountBalanceItemSchema),
})
export type AccountBalanceListView = z.infer<typeof AccountBalanceListViewSchema>
