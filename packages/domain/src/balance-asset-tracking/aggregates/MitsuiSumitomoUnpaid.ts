/**
 * 三井住友カード未払金集約
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/09-aggregates.md #10
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §6.2
 *
 * 不変条件:
 *  - 当月未払金合計 = Σ 計上中エントリ金額（集約内整合）
 *  - 引落消込変動は冪等（同一 settlementNoticeId で重複適用しない。settleUnpaid が集約内で保証）
 */
import { z } from 'zod'
import {
  MitsuiSumitomoUnpaidIdSchema,
  AccountIdSchema,
  TransactionIdSchema,
  UnpaidEntryIdSchema,
  SettlementNoticeIdSchema,
  type TransactionId,
  type UnpaidEntryId,
  type SettlementNoticeId,
} from '../../shared/ids'
import { MoneySchema, money, addMoney, type Money } from '../../shared/value-objects/Money'
import { InvariantViolationError } from '../../shared/errors/DomainError'

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

export type BookedUnpaidEntry = Extract<UnpaidEntry, { kind: 'booked' }>
export type SettledUnpaidEntry = Extract<UnpaidEntry, { kind: 'settled' }>

/**
 * behavior 取引で未払金を計上する（08d §2）
 * 事前: 取引種別 = カード利用（呼び出し側で保証）
 * 事後: 計上中エントリとして追加され、当月未払金合計に加算される
 * 同一取引IDの二重計上は InvariantViolationError で拒否する。
 */
export function bookUnpaid(
  unpaid: MitsuiSumitomoUnpaid,
  entry: { entryId: UnpaidEntryId; transactionId: TransactionId; amount: Money; bookedAt: Date },
): MitsuiSumitomoUnpaid {
  if (unpaid.entries.some(e => e.transactionId === entry.transactionId)) {
    throw new InvariantViolationError(
      `取引（${entry.transactionId}）は計上済みのため二重計上できない`,
    )
  }
  return MitsuiSumitomoUnpaidSchema.parse({
    unpaidAggregateId: unpaid.unpaidAggregateId,
    accountId: unpaid.accountId,
    currentMonthUnpaidTotal: addMoney(unpaid.currentMonthUnpaidTotal, entry.amount),
    entries: [...unpaid.entries, { kind: 'booked', ...entry }],
    lastSettledAt: unpaid.lastSettledAt,
  })
}

/**
 * behavior 引落確定通知で未払金を消込する（08d §2）
 * 事後: 全計上中エントリが引落消込済みに遷移し、当月未払金合計は 0 になる。
 *       戻り値の settledTotal が SMBC 残高から減算すべき引落消込変動。
 * 同一 settlementNoticeId の重複適用は InvariantViolationError で拒否する。
 * 契約: 同一通知の再受信（リトライ）時、呼び出し側はこのエラーを「適用済みのため
 * スキップ」として扱ってよい（残高減算などの後続処理も再実行しないこと）。
 */
export function settleUnpaid(
  unpaid: MitsuiSumitomoUnpaid,
  settlementNoticeId: SettlementNoticeId,
  settledAt: Date,
): { unpaid: MitsuiSumitomoUnpaid; settledEntries: SettledUnpaidEntry[]; settledTotal: Money } {
  if (
    unpaid.entries.some(e => e.kind === 'settled' && e.settlementNoticeId === settlementNoticeId)
  ) {
    throw new InvariantViolationError(
      `引落確定通知（${settlementNoticeId}）は消込適用済みのため重複適用できない`,
    )
  }
  const booked = unpaid.entries.filter((e): e is BookedUnpaidEntry => e.kind === 'booked')
  if (booked.length === 0) {
    throw new InvariantViolationError('計上中エントリが存在しないため消込できない')
  }
  const settledEntries = booked.map(
    (e): SettledUnpaidEntry => ({
      kind: 'settled',
      entryId: e.entryId,
      transactionId: e.transactionId,
      bookedAt: e.bookedAt,
      settledAt,
      amount: e.amount,
      settlementNoticeId,
    }),
  )
  const settledTotal = booked.reduce((acc, e) => addMoney(acc, e.amount), money(0))
  const next = MitsuiSumitomoUnpaidSchema.parse({
    unpaidAggregateId: unpaid.unpaidAggregateId,
    accountId: unpaid.accountId,
    currentMonthUnpaidTotal: 0,
    entries: [...unpaid.entries.filter(e => e.kind === 'settled'), ...settledEntries],
    lastSettledAt: settledAt,
  })
  return { unpaid: next, settledEntries, settledTotal }
}
