/**
 * NISA積立累計補正イベント（08d §3、#458）
 * data NISA積立累計補正イベント = 口座ID AND 補正前累計 AND 補正後累計 AND 補正者ユーザーID AND 発生日時
 *
 * 振込由来の加算（`NisaContributionAdded`）とは別イベントにする。加算は「いくら積み立てたか」を
 * 積み増す変動で、補正は「実際はいくらだったか」への差し替えのため、購読側が同一視すると
 * 補正後の累計を加算額として扱う取り違えが起きうる。
 *
 * 変動額ではなく前後の累計を載せる（補正は差分ではなく差し替えの操作で、購読側は
 * 補正後累計をそのまま使う。差分が要るときは 補正後 − 補正前 で導ける）。
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema, UserIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const NisaContributionCorrectedSchema = DomainEventBaseSchema.extend({
  type: z.literal('NisaContributionCorrected'),
  accountId: AccountIdSchema,
  oldAccumulated: MoneySchema,
  newAccumulated: MoneySchema,
  correctedByUserId: UserIdSchema,
})
export type NisaContributionCorrected = z.infer<typeof NisaContributionCorrectedSchema>
