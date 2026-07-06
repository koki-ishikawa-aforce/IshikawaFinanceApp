/**
 * 一括分類セッション集約（自動分類・学習コンテキスト）
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/domain/09-aggregates.md #6
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * kawasima: data 一括分類セッション = ユーザーID AND 取込起因 AND List<未分類取引> AND 一括分類状態
 *
 * 不変条件:
 *  - ユーザーID + 取込起因で 1 セッションに限定（進行中セッションの二重起動なし、
 *    Repository.findInProgressByUser で保証、Phase 5 M-B）
 *  - 完了・中断状態からは再開しない（終端状態からの遷移関数を提供しない）
 *  - N-1: 同一加盟店の複数取引へのルールは 1 件に集約される（behavior で保証、Phase 5 M-B）
 */
import { z } from 'zod'
import {
  BulkClassificationSessionIdSchema,
  UserIdSchema,
  ImportJobIdSchema,
  TransactionIdSchema,
} from '../../shared/ids'
import { BulkClassificationTargetSchema } from '../value-objects/ClassificationResult'

/** 取込起因（CSV取込ID は取引取込の取込ジョブ ID にマップ） */
export const BulkClassificationTriggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('csv_import'),
    importJobId: ImportJobIdSchema,
    startedAt: z.date(),
  }),
  z.object({
    kind: z.literal('single_correction'),
    transactionId: TransactionIdSchema,
    startedAt: z.date(),
  }),
])
export type BulkClassificationTrigger = z.infer<typeof BulkClassificationTriggerSchema>

/** 共通属性 */
export const CommonBulkClassificationSessionAttrsSchema = z.object({
  bulkClassificationSessionId: BulkClassificationSessionIdSchema,
  userId: UserIdSchema,
  trigger: BulkClassificationTriggerSchema,
  targets: z.array(BulkClassificationTargetSchema),
})
export type CommonBulkClassificationSessionAttrs = z.infer<
  typeof CommonBulkClassificationSessionAttrsSchema
>

export const BulkClassificationSessionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('in_progress'),
    common: CommonBulkClassificationSessionAttrsSchema,
    startedAt: z.date(),
    remainingCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('completed'),
    common: CommonBulkClassificationSessionAttrsSchema,
    startedAt: z.date(),
    completedAt: z.date(),
    processedCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('aborted'),
    common: CommonBulkClassificationSessionAttrsSchema,
    startedAt: z.date(),
    abortedAt: z.date(),
    remainingCount: z.number().int().nonnegative(),
  }),
])
export type BulkClassificationSession = z.infer<typeof BulkClassificationSessionSchema>

export type InProgressBulkClassificationSession = Extract<
  BulkClassificationSession,
  { kind: 'in_progress' }
>
export type CompletedBulkClassificationSession = Extract<
  BulkClassificationSession,
  { kind: 'completed' }
>
export type AbortedBulkClassificationSession = Extract<
  BulkClassificationSession,
  { kind: 'aborted' }
>

/** 状態遷移: 進行中 → 完了 */
export function completeBulkClassificationSession(
  session: InProgressBulkClassificationSession,
  processedCount: number,
  at: Date,
): CompletedBulkClassificationSession {
  return BulkClassificationSessionSchema.parse({
    kind: 'completed',
    common: session.common,
    startedAt: session.startedAt,
    completedAt: at,
    processedCount,
  }) as CompletedBulkClassificationSession
}

/** 状態遷移: 進行中 → 中断 */
export function abortBulkClassificationSession(
  session: InProgressBulkClassificationSession,
  at: Date,
): AbortedBulkClassificationSession {
  return BulkClassificationSessionSchema.parse({
    kind: 'aborted',
    common: session.common,
    startedAt: session.startedAt,
    abortedAt: at,
    remainingCount: session.remainingCount,
  }) as AbortedBulkClassificationSession
}
