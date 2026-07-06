/**
 * 突合差額（経費精算入金と月次経費サイクルの突合結果）
 * @see docs/domain/08e-ul-経費精算.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 *
 * kawasima: data 突合差額 = 不認定分 OR 認定済み超過 OR 完全一致
 */
import { z } from 'zod'
import { MoneySchema } from '../../shared/value-objects/Money'

export const SettlementMatchDifferenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unapproved_shortfall'), difference: MoneySchema }),
  z.object({ kind: z.literal('approved_excess'), difference: MoneySchema }),
  z.object({ kind: z.literal('exact_match') }),
])
export type SettlementMatchDifference = z.infer<typeof SettlementMatchDifferenceSchema>
