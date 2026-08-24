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
 *  - 進行中の 分類済み取引 は対象取引の部分集合で重複を持たない
 *  - 進行中の 残件数 = 対象取引数 - 分類済み取引数（進捗と残件数が食い違わない）
 */
import { z } from 'zod'
import {
  BulkClassificationSessionIdSchema,
  UserIdSchema,
  ImportJobIdSchema,
  TransactionIdSchema,
  type BulkClassificationSessionId,
  type TransactionId,
  type UserId,
} from '../../shared/ids'
import {
  BulkClassificationTargetSchema,
  type BulkClassificationTarget,
} from '../value-objects/ClassificationResult'

/**
 * 取込起因（CSV取込ID は取引取込の取込ジョブ ID にマップ）
 *
 * 取引一覧起因は起点となる 1 件を持たない（未分類の一覧そのものが起点）ため、
 * 単発修正起因と違い取引IDを持たない。
 */
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
  z.object({
    kind: z.literal('transaction_list'),
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

export const BulkClassificationSessionSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('in_progress'),
      common: CommonBulkClassificationSessionAttrsSchema,
      startedAt: z.date(),
      /**
       * 分類済みとして記録された対象取引（途中経過）。
       * 進捗を持たなかった頃に保存された行を読み戻せるよう既定は空にする
       * （その場合 残件数 = 対象取引数 となり、不変条件と矛盾しない）。
       */
      classifiedTransactionIds: z.array(TransactionIdSchema).default([]),
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
  .superRefine((session, ctx) => {
    if (session.kind !== 'in_progress') return
    const targetIds = new Set<string>(session.common.targets.map(target => target.transactionId))
    if (
      new Set(session.classifiedTransactionIds).size !== session.classifiedTransactionIds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '分類済み取引に重複がある',
        path: ['classifiedTransactionIds'],
      })
    }
    const unknown = session.classifiedTransactionIds.filter(id => !targetIds.has(id))
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `対象に含まれない取引は分類済みにできない: ${unknown.join(', ')}`,
        path: ['classifiedTransactionIds'],
      })
    }
    const expected = session.common.targets.length - session.classifiedTransactionIds.length
    if (session.remainingCount !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `残件数は 対象取引数 - 分類済み取引数 と一致する必要がある: ${expected} を期待したが ${session.remainingCount}`,
        path: ['remainingCount'],
      })
    }
  })
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

/**
 * 一括分類セッションを開始する（08b §3「一括分類セッションを開始する」）
 *
 * 事後条件「分類済み取引ID は空、残件数 = 対象取引数」をここで満たす。
 * 対象取引が本人のもので未分類かの判定は I/O を伴うため呼び出し側（api）に残す。
 */
export function startBulkClassificationSession(input: {
  bulkClassificationSessionId: BulkClassificationSessionId
  userId: UserId
  trigger: BulkClassificationTrigger
  targets: readonly BulkClassificationTarget[]
}): InProgressBulkClassificationSession {
  return BulkClassificationSessionSchema.parse({
    kind: 'in_progress',
    common: {
      bulkClassificationSessionId: input.bulkClassificationSessionId,
      userId: input.userId,
      trigger: input.trigger,
      targets: input.targets,
    },
    startedAt: input.trigger.startedAt,
    classifiedTransactionIds: [],
    remainingCount: input.targets.length,
  }) as InProgressBulkClassificationSession
}

/**
 * 状態遷移: 進行中 → 進行中（分類し終えた対象を記録して残件数を減らす）
 *
 * 既に記録済みの取引を再度渡しても結果は変わらない（同じ要求の再送で二重に
 * 減算されない）。対象に含まれない取引を渡した場合は不変条件で弾かれる。
 */
export function advanceBulkClassificationSession(
  session: InProgressBulkClassificationSession,
  classifiedTransactionIds: readonly TransactionId[],
): InProgressBulkClassificationSession {
  const merged = [...new Set([...session.classifiedTransactionIds, ...classifiedTransactionIds])]
  return BulkClassificationSessionSchema.parse({
    kind: 'in_progress',
    common: session.common,
    startedAt: session.startedAt,
    classifiedTransactionIds: merged,
    remainingCount: session.common.targets.length - merged.length,
  }) as InProgressBulkClassificationSession
}

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
