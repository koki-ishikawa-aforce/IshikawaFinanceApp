import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const BalancePointSchema = z.object({
  date: z.date(),
  amount: MoneySchema,
  /**
   * 実際の記録ではなく、期間の始まりに置いた表示のための補助点かどうか
   * （`BalanceSeriesPoint.isCarriedForward` をそのまま運ぶ。#538）。
   */
  isCarriedForward: z.boolean(),
})
export type BalancePoint = z.infer<typeof BalancePointSchema>

export const BalanceTimeSeriesViewSchema = z.object({
  yearMonthRange: z.object({
    from: z.string(),
    to: z.string(),
  }),
  smbc: z.array(BalancePointSchema),
  otherSavings: z.array(BalancePointSchema),
  nisaContribution: z.array(BalancePointSchema),
  cardUnpaid: z.array(BalancePointSchema),
})
export type BalanceTimeSeriesView = z.infer<typeof BalanceTimeSeriesViewSchema>
