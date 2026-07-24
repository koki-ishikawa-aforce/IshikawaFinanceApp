import { Hono } from 'hono'
import { z } from 'zod'
import {
  BulkClassificationCompletedSchema,
  BulkClassificationSessionIdSchema,
  BulkClassificationSessionSchema,
  ClassifiedDetailsSchema,
  ImportJobIdSchema,
  InvariantViolationError,
  NotFoundError,
  PermissionDeniedError,
  RetroactiveReclassificationAppliedSchema,
  TransactionIdSchema,
  abortBulkClassificationSession,
  applicableClassification,
  assertPersonalExpenseClassMatchesRole,
  classify,
  completeBulkClassificationSession,
} from '@warimaru/domain'
import type {
  ActiveMerchantLearningRule,
  AmazonProductKeyLearningRuleRepository,
  BulkClassificationSession,
  BulkClassificationSessionRepository,
  ClassifiedDetails,
  EventBus,
  InProgressBulkClassificationSession,
  MerchantLearningRuleRepository,
  RetroactiveCandidateQuery,
  TransactionRepository,
  UserId,
  UserRole,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'

const RetroactiveParamsSchema = z.object({
  merchantName: z.string().min(1),
})

const RetroactiveApplyBodySchema = z.object({
  merchantName: z.string().min(1),
  transactionIds: z.array(TransactionIdSchema).min(1).optional(),
})

const BulkSessionCreateBodySchema = z.object({
  trigger: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('csv_import'), importJobId: ImportJobIdSchema }),
    z.object({ kind: z.literal('single_correction'), transactionId: TransactionIdSchema }),
  ]),
  transactionIds: z.array(TransactionIdSchema).min(1),
})

export interface ClassificationRoutesDeps {
  retroactiveCandidateQuery: RetroactiveCandidateQuery
  merchantLearningRuleRepository: MerchantLearningRuleRepository
  amazonProductKeyLearningRuleRepository: AmazonProductKeyLearningRuleRepository
  bulkClassificationSessionRepository: BulkClassificationSessionRepository
  transactionRepository: TransactionRepository
  resolveViewerRole: (viewerId: UserId) => Promise<UserRole>
  eventBus: EventBus
}

/**
 * 学習済みの 3 軸から分類詳細を構築する。
 * 「未学習軸が残るルールは適用不可」という不変条件は domain の
 * `applicableClassification` に一元化し（CLAUDE.md: api で再実装しない）、
 * ここは得られた分類を merchant_rule 由来の ClassifiedDetails へ組み立てるだけ。
 */
function detailsFromRule(rule: ActiveMerchantLearningRule): ClassifiedDetails {
  const classification = applicableClassification(rule)
  return ClassifiedDetailsSchema.parse({
    categoryId: classification.categoryId,
    expenseClass: classification.expenseClass,
    expenseTypeRef:
      classification.expenseClass === 'business_expense' &&
      classification.expenseTypeId !== undefined
        ? { kind: 'business', expenseTypeId: classification.expenseTypeId }
        : { kind: 'non_business' },
    basis: {
      kind: 'merchant_rule',
      merchantName: rule.common.merchantName,
      ruleLastUpdatedAt: rule.lastUpdatedAt,
    },
  })
}

function assertSessionOwnedByViewer(session: BulkClassificationSession, viewerId: UserId): void {
  if (session.common.userId !== viewerId) {
    throw new PermissionDeniedError('他ユーザーの一括分類セッションは操作できない')
  }
}

function assertInProgress(
  session: BulkClassificationSession,
): asserts session is InProgressBulkClassificationSession {
  if (session.kind !== 'in_progress') {
    throw new InvariantViolationError(
      `進行中でないセッションは操作できない（現状態: ${session.kind}）`,
    )
  }
}

export function classificationRoutes(deps: ClassificationRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** 遡及適用候補の取得 */
  app.get('/retroactive-candidates', async c => {
    const params = RetroactiveParamsSchema.parse({ merchantName: c.req.query('merchantName') })
    const viewerId = c.get('viewerId')
    const view = await deps.retroactiveCandidateQuery.fetchCandidates(
      viewerId,
      params.merchantName.normalize('NFKC').trim(),
    )
    return c.json(view)
  })

  /** 遡及適用の実行（学習済み加盟店ルールを過去の未分類取引へ適用） */
  app.post('/retroactive-candidates/apply', async c => {
    const body = RetroactiveApplyBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const merchantName = body.merchantName.normalize('NFKC').trim()

    const rule = await deps.merchantLearningRuleRepository.findByMerchant(viewerId, merchantName)
    if (rule === null) throw new NotFoundError('MerchantLearningRule', merchantName)
    if (rule.kind !== 'active') {
      throw new InvariantViolationError(`無効化された学習ルールは遡及適用できない: ${merchantName}`)
    }
    const details = detailsFromRule(rule)
    // C#11 の防御的多重化: 遡及適用先は必ず viewer 所有（下のループでガード）なので、
    // ルール由来の個人費用区分が viewer のロールと整合することをここでも強制する。
    assertPersonalExpenseClassMatchesRole(
      details.expenseClass,
      await deps.resolveViewerRole(viewerId),
    )

    const view = await deps.retroactiveCandidateQuery.fetchCandidates(viewerId, merchantName)
    const candidateIds = view.candidates.map(candidate => candidate.transactionId)
    const targetIds =
      body.transactionIds === undefined
        ? candidateIds
        : candidateIds.filter(id => body.transactionIds?.includes(id))

    let appliedCount = 0
    for (const transactionId of targetIds) {
      const transaction = await deps.transactionRepository.findById(transactionId)
      if (
        transaction === null ||
        transaction.kind !== 'unclassified' ||
        transaction.common.ownerUserId !== viewerId
      ) {
        continue
      }
      await deps.transactionRepository.save(classify(transaction, details))
      appliedCount++
    }
    // 08b §3 J-3: 実際に再分類された取引がある場合のみ「過去未分類が一括再分類された」
    // イベントを発行する。1 件も適用されなければ再分類は成立していないため発行しない。
    // 配信は at-least-once（apply 再実行で再発行されうる）ため購読側は冪等前提。
    if (appliedCount > 0) {
      await deps.eventBus.publish(
        RetroactiveReclassificationAppliedSchema.parse({
          ...domainEventBase(),
          type: 'RetroactiveReclassificationApplied',
          userId: viewerId,
          targetCount: appliedCount,
        }),
      )
    }
    return c.json({ merchantName, appliedCount })
  })

  /** 加盟店学習ルール一覧 */
  app.get('/merchant-rules', async c => {
    const viewerId = c.get('viewerId')
    const items = await deps.merchantLearningRuleRepository.findAllByUser(viewerId)
    return c.json({ items })
  })

  /** Amazon 商品キー学習ルール一覧 */
  app.get('/amazon-rules', async c => {
    const viewerId = c.get('viewerId')
    const items = await deps.amazonProductKeyLearningRuleRepository.findAllByUser(viewerId)
    return c.json({ items })
  })

  /** 一括分類セッションの開始 */
  app.post('/bulk-sessions', async c => {
    const body = BulkSessionCreateBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const existing = await deps.bulkClassificationSessionRepository.findInProgressByUser(viewerId)
    if (existing !== null) {
      throw new InvariantViolationError(
        `進行中の一括分類セッションが既に存在する: ${existing.common.bulkClassificationSessionId}`,
      )
    }
    const now = new Date()
    const targets = []
    for (const transactionId of body.transactionIds) {
      const transaction = await deps.transactionRepository.findById(transactionId)
      if (transaction === null) throw new NotFoundError('Transaction', transactionId)
      if (transaction.common.ownerUserId !== viewerId) {
        throw new PermissionDeniedError('他ユーザーの取引は一括分類の対象にできない')
      }
      if (transaction.kind !== 'unclassified') {
        throw new InvariantViolationError(
          `未分類でない取引は一括分類の対象にできない: ${transactionId}`,
        )
      }
      targets.push({
        kind: 'unclassified' as const,
        transactionId: transaction.common.transactionId,
        merchantName: transaction.common.merchantName,
        reason: transaction.reason,
        defaultExpenseClass: transaction.defaultExpenseClass,
      })
    }
    const session = BulkClassificationSessionSchema.parse({
      kind: 'in_progress',
      common: {
        bulkClassificationSessionId: BulkClassificationSessionIdSchema.parse(newUlid()),
        userId: viewerId,
        trigger: { ...body.trigger, startedAt: now },
        targets,
      },
      startedAt: now,
      remainingCount: targets.length,
    })
    await deps.bulkClassificationSessionRepository.save(session)
    return c.json(session, 201)
  })

  /** 進行中の一括分類セッション取得 */
  app.get('/bulk-sessions/current', async c => {
    const viewerId = c.get('viewerId')
    const session = await deps.bulkClassificationSessionRepository.findInProgressByUser(viewerId)
    return c.json({ session })
  })

  app.get('/bulk-sessions/:id', async c => {
    const id = BulkClassificationSessionIdSchema.parse(c.req.param('id'))
    const viewerId = c.get('viewerId')
    const session = await deps.bulkClassificationSessionRepository.findById(id)
    if (session === null) throw new NotFoundError('BulkClassificationSession', id)
    assertSessionOwnedByViewer(session, viewerId)
    return c.json(session)
  })

  /** 一括分類セッションの完了（processedCount は対象取引の実状態から算出する） */
  app.post('/bulk-sessions/:id/complete', async c => {
    const id = BulkClassificationSessionIdSchema.parse(c.req.param('id'))
    const viewerId = c.get('viewerId')
    const session = await deps.bulkClassificationSessionRepository.findById(id)
    if (session === null) throw new NotFoundError('BulkClassificationSession', id)
    assertSessionOwnedByViewer(session, viewerId)
    assertInProgress(session)
    let processedCount = 0
    for (const target of session.common.targets) {
      const transaction = await deps.transactionRepository.findById(target.transactionId)
      if (transaction !== null && transaction.kind !== 'unclassified') processedCount++
    }
    const completed = completeBulkClassificationSession(session, processedCount, new Date())
    await deps.bulkClassificationSessionRepository.save(completed)
    // 08b §3 N-1: セッション完了を「一括分類完了」イベントとして発行する（処理件数に
    // 依らず完了そのものがイベント）。完了後の再実行は assertInProgress で弾かれ再発行
    // されない（apply と違い replay できないため、この経路は実質 at-most-once）。
    await deps.eventBus.publish(
      BulkClassificationCompletedSchema.parse({
        ...domainEventBase(),
        type: 'BulkClassificationCompleted',
        bulkClassificationSessionId: completed.common.bulkClassificationSessionId,
        processedCount,
      }),
    )
    return c.json(completed)
  })

  /** 一括分類セッションの中断 */
  app.post('/bulk-sessions/:id/abort', async c => {
    const id = BulkClassificationSessionIdSchema.parse(c.req.param('id'))
    const viewerId = c.get('viewerId')
    const session = await deps.bulkClassificationSessionRepository.findById(id)
    if (session === null) throw new NotFoundError('BulkClassificationSession', id)
    assertSessionOwnedByViewer(session, viewerId)
    assertInProgress(session)
    const aborted = abortBulkClassificationSession(session, new Date())
    await deps.bulkClassificationSessionRepository.save(aborted)
    return c.json(aborted)
  })

  return app
}
