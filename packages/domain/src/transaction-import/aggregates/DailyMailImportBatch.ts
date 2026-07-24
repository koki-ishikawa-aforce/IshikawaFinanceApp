/**
 * 日次メール取込バッチ集約（取引取込コンテキスト）
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/domain/09-aggregates.md #2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * kawasima: data 日次メール取込バッチ = 起動済み OR 取込中 OR 完了 OR 失敗
 *
 * 不変条件:
 *  - バッチ起動中は同一ユーザーID の二重起動が発生しない
 *    （Repository.findInProgressByUser で保証、Phase 5 M-B）
 *  - 完了・失敗の終端状態からは遷移しない（終端からの遷移関数を提供しない）
 *  - 取込対象期間は from < to（過去 5 日再走査、OQ-31）
 */
import { z } from 'zod'
import { ImportBatchIdSchema, UserIdSchema } from '../../shared/ids'

/**
 * 取込対象期間の不変条件: from は to より前でなければならない
 * （過去 5 日再走査, OQ-31）。この述語が from < to ルールの単一の情報源であり、
 * 集約スキーマ（{@link ImportTargetPeriodSchema}）と API 境界の双方がこれを参照する。
 * adapters / api 層で `from < to` を再実装しないこと。
 */
export function importTargetPeriodIsValid(from: Date, to: Date): boolean {
  return from < to
}

/** 取込対象期間 */
export const ImportTargetPeriodSchema = z
  .object({
    from: z.date(),
    to: z.date(),
  })
  .refine(period => importTargetPeriodIsValid(period.from, period.to), {
    message: '取込対象期間は from < to でなければならない',
    path: ['to'],
  })
export type ImportTargetPeriod = z.infer<typeof ImportTargetPeriodSchema>

/** 共通属性 */
export const CommonImportBatchAttrsSchema = z.object({
  importBatchId: ImportBatchIdSchema,
  userId: UserIdSchema,
  launchedAt: z.date(),
  targetPeriod: ImportTargetPeriodSchema,
})
export type CommonImportBatchAttrs = z.infer<typeof CommonImportBatchAttrsSchema>

export const DailyMailImportBatchSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('started'),
    common: CommonImportBatchAttrsSchema,
  }),
  z.object({
    kind: z.literal('importing'),
    common: CommonImportBatchAttrsSchema,
    importStartedAt: z.date(),
    importedCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('completed'),
    common: CommonImportBatchAttrsSchema,
    completedAt: z.date(),
    importedCount: z.number().int().nonnegative(),
    duplicateExcludedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('failed'),
    common: CommonImportBatchAttrsSchema,
    failedAt: z.date(),
    failureDetail: z.string().min(1),
  }),
])
// from < to の不変条件は ImportTargetPeriodSchema（値オブジェクト）が担保する。
// common.targetPeriod が同スキーマを参照するため、集約 parse 時にネストして検証される。
export type DailyMailImportBatch = z.infer<typeof DailyMailImportBatchSchema>

export type StartedImportBatch = Extract<DailyMailImportBatch, { kind: 'started' }>
export type ImportingImportBatch = Extract<DailyMailImportBatch, { kind: 'importing' }>
export type CompletedImportBatch = Extract<DailyMailImportBatch, { kind: 'completed' }>
export type FailedImportBatch = Extract<DailyMailImportBatch, { kind: 'failed' }>

/** 状態遷移: 起動済み → 取込中 */
export function startBatchImporting(batch: StartedImportBatch, at: Date): ImportingImportBatch {
  return DailyMailImportBatchSchema.parse({
    kind: 'importing',
    common: batch.common,
    importStartedAt: at,
    importedCount: 0,
  }) as ImportingImportBatch
}

/** 状態遷移: 取込中 → 完了（終端） */
export function completeBatch(
  batch: ImportingImportBatch,
  counts: { importedCount: number; duplicateExcludedCount: number; failedCount: number },
  at: Date,
): CompletedImportBatch {
  return DailyMailImportBatchSchema.parse({
    kind: 'completed',
    common: batch.common,
    completedAt: at,
    ...counts,
  }) as CompletedImportBatch
}

/** 状態遷移: 起動済み/取込中 → 失敗（終端） */
export function failBatch(
  batch: StartedImportBatch | ImportingImportBatch,
  failureDetail: string,
  at: Date,
): FailedImportBatch {
  return DailyMailImportBatchSchema.parse({
    kind: 'failed',
    common: batch.common,
    failedAt: at,
    failureDetail,
  }) as FailedImportBatch
}
