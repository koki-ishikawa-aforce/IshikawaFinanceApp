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

/**
 * 残高一覧（P2-B5 / AT-404 / OQ-60）。
 *
 * `items` は閲覧者本人の口座のみ。配偶者の口座は 1 件ずつ並べず、別銀行貯蓄残高と
 * NISA 積立累計の合計だけを `spouseOtherSavingsAndNisaTotal` で渡す（配偶者の SMBC
 * 残高・カード未払金は返さない）。配偶者に対象の口座が 1 件も無ければ null で、
 * 「配偶者の分が 0 円」と「配偶者が対象の口座を持たない」を画面が区別できるようにする。
 */
export const AccountBalanceListViewSchema = z.object({
  items: z.array(AccountBalanceItemSchema),
  spouseOtherSavingsAndNisaTotal: MoneySchema.nullable(),
})
export type AccountBalanceListView = z.infer<typeof AccountBalanceListViewSchema>
