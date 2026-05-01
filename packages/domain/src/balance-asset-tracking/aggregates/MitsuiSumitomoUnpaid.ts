/**
 * 三井住友カード未払金集約
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/09-aggregates.md #10
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.2
 *
 * 不変条件:
 *  - 当月未払金合計 = Σ 計上中エントリ金額（集約内整合）
 *  - 引落消込変動は冪等（同一 settlementNoticeId で重複適用しない、Phase 5 の application service で保証）
 */
import { z } from 'zod'
import {
  MitsuiSumitomoUnpaidIdSchema,
  AccountIdSchema,
  TransactionIdSchema,
  UnpaidEntryIdSchema,
  SettlementNoticeIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const UnpaidEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('booked'),
    entryId: UnpaidEntryIdSchema,
    transactionId: TransactionIdSchema,
    bookedAt: z.date(),
    amount: MoneySchema,
  }),
  z.object({
    kind: z.literal('settled'),
    entryId: UnpaidEntryIdSchema,
    transactionId: TransactionIdSchema,
    bookedAt: z.date(),
    settledAt: z.date(),
    amount: MoneySchema,
    settlementNoticeId: SettlementNoticeIdSchema,
  }),
])
export type UnpaidEntry = z.infer<typeof UnpaidEntrySchema>

export const MitsuiSumitomoUnpaidSchema = z
  .object({
    unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema,
    accountId: AccountIdSchema,
    currentMonthUnpaidTotal: MoneySchema,
    entries: z.array(UnpaidEntrySchema),
    lastSettledAt: z.date().nullable(),
  })
  .superRefine((agg, ctx) => {
    const sumBooked = agg.entries
      .filter((e): e is Extract<UnpaidEntry, { kind: 'booked' }> => e.kind === 'booked')
      .reduce((acc, e) => acc + e.amount, 0)
    if (sumBooked !== agg.currentMonthUnpaidTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `当月未払金合計（${agg.currentMonthUnpaidTotal}）と計上中エントリ合計（${sumBooked}）が一致しない`,
        path: ['currentMonthUnpaidTotal'],
      })
    }
  })
export type MitsuiSumitomoUnpaid = z.infer<typeof MitsuiSumitomoUnpaidSchema>
