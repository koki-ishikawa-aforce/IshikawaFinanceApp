import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const AssetTotalViewSchema = z.object({
  asOf: z.date(),
  smbcBalance: MoneySchema,
  otherSavingsBalance: MoneySchema,
  nisaContributionAccumulated: MoneySchema,
  cardUnpaidTotal: MoneySchema,
  /** = smbcBalance + otherSavingsBalance + nisaContributionAccumulated - cardUnpaidTotal */
  total: MoneySchema,
})
export type AssetTotalView = z.infer<typeof AssetTotalViewSchema>
