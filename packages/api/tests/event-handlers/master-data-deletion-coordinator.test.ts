/**
 * マスタ削除コーディネーターのハンドラーテスト（#223 / #431）
 *
 * コーディネーターの守り（全コンテキストの完了通知が揃ってはじめて物理削除する・
 * 完了済み / 失敗済みリクエストへの通知は無視する）を、HTTP ルートを介さずに
 * registerMasterDataDeletionCoordinator を直接呼んで検証する。
 *
 * ルート経由でしか確かめられないと、完了通知が揃わない状況を作るために
 * 購読の解除や保存処理の差し替えといった細工が要り、テストが実装の都合
 * （保存の呼び出し回数など）に依存する。ここでは各コンテキストの完了通知イベントを
 * 直接 publish するだけで、揃う / 揃わないの両方を素朴に作れる。
 */
import { describe, it, expect } from 'vitest'
import {
  CategoryDeletionRequestSchema,
  CategoryDeletionRequestIdSchema,
  CategoryIdSchema,
  CategoryLearningRulesRemappedSchema,
  CategoryMasterSchema,
  CategoryTransactionsRemappedSchema,
  ExpenseTypeDeletionRequestSchema,
  ExpenseTypeDeletionRequestIdSchema,
  ExpenseTypeIdSchema,
  ExpenseTypeLearningRulesRemappedSchema,
  ExpenseTypeMasterSchema,
  ExpenseTypeTransactionsRemappedSchema,
  InMemoryEventBus,
  MonthlyLimitIdSchema,
  MonthlyLimitSchema,
  UserIdSchema,
  requestCategoryRemap,
  requestExpenseTypeRemap,
} from '@warimaru/domain'
import type {
  CategoryDeletionCompleted,
  CategoryDeletionRequest,
  CategoryDeletionRequestId,
  CategoryId,
  DeletionRequestState,
  ExpenseTypeDeletionCompleted,
  ExpenseTypeDeletionRequest,
  ExpenseTypeDeletionRequestId,
  ExpenseTypeId,
  PendingRemapCategoryDeletionRequest,
  PendingRemapExpenseTypeDeletionRequest,
  UserId,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import {
  createMockCategoryDeletionRequestRepository,
  createMockCategoryMasterRepository,
  createMockExpenseTypeDeletionRequestRepository,
  createMockExpenseTypeMasterRepository,
  createMockMonthlyLimitRepository,
} from '../../src/mock-repositories.js'
import { registerMasterDataDeletionCoordinator } from '../../src/event-handlers/master-data-deletion-coordinator.js'

const OWNER_ID: UserId = UserIdSchema.parse('user-honey-test')
const AT = new Date('2026-07-10T00:00:00Z')

interface Harness {
  eventBus: InMemoryEventBus
  deps: ReturnType<typeof createDeps>
  /** コーディネーターが発行した削除完了イベント（発行時点の外部状態つき） */
  categoryCompleted: CategoryDeletionCompleted[]
  expenseTypeCompleted: ExpenseTypeDeletionCompleted[]
}

function createDeps() {
  return {
    categoryMasterRepository: createMockCategoryMasterRepository(),
    expenseTypeMasterRepository: createMockExpenseTypeMasterRepository(),
    monthlyLimitRepository: createMockMonthlyLimitRepository(),
    categoryDeletionRequestRepository: createMockCategoryDeletionRequestRepository(),
    expenseTypeDeletionRequestRepository: createMockExpenseTypeDeletionRequestRepository(),
  }
}

function createHarness(): Harness {
  const eventBus = new InMemoryEventBus()
  const deps = createDeps()
  registerMasterDataDeletionCoordinator(eventBus, deps)

  const categoryCompleted: CategoryDeletionCompleted[] = []
  const expenseTypeCompleted: ExpenseTypeDeletionCompleted[] = []
  eventBus.subscribe<CategoryDeletionCompleted>('CategoryDeletionCompleted', e => {
    categoryCompleted.push(e)
    return Promise.resolve()
  })
  eventBus.subscribe<ExpenseTypeDeletionCompleted>('ExpenseTypeDeletionCompleted', e => {
    expenseTypeCompleted.push(e)
    return Promise.resolve()
  })

  return { eventBus, deps, categoryCompleted, expenseTypeCompleted }
}

// --- カテゴリ側の下ごしらえ ---

async function seedCategoryMaster(h: Harness, name: string): Promise<CategoryId> {
  const categoryId = CategoryIdSchema.parse(newUlid())
  await h.deps.categoryMasterRepository.save(
    CategoryMasterSchema.parse({
      kind: 'custom',
      categoryId,
      name,
      scope: { kind: 'personal', userId: OWNER_ID },
      createdAt: AT,
      createdByUserId: OWNER_ID,
      renameHistory: [],
    }),
  )
  return categoryId
}

/** リマップ依頼済み（家計分析・自動分類の 2 コンテキスト待ち）のカテゴリ削除リクエストを保存する */
async function seedRemapRequestedCategoryDeletion(
  h: Harness,
  targetCategoryId: CategoryId,
): Promise<CategoryDeletionRequestId> {
  const categoryDeletionRequestId = CategoryDeletionRequestIdSchema.parse(newUlid())
  const pending = CategoryDeletionRequestSchema.parse({
    categoryDeletionRequestId,
    targetCategoryId,
    requestedByUserId: OWNER_ID,
    destinationCategoryId: CategoryIdSchema.parse(newUlid()),
    destinationExpenseClass: 'household',
    requestedAt: AT,
    state: { kind: 'pending_remap' },
  }) as PendingRemapCategoryDeletionRequest
  const requested = requestCategoryRemap(pending, ['household_analysis', 'auto_classification'], AT)
  await h.deps.categoryDeletionRequestRepository.save(requested)
  return categoryDeletionRequestId
}

/** 任意の状態のカテゴリ削除リクエストを保存する（完了済み / 失敗済みへの通知を作るため） */
async function saveCategoryDeletionWithState(
  h: Harness,
  categoryDeletionRequestId: CategoryDeletionRequestId,
  targetCategoryId: CategoryId,
  state: DeletionRequestState,
): Promise<void> {
  await h.deps.categoryDeletionRequestRepository.save(
    CategoryDeletionRequestSchema.parse({
      categoryDeletionRequestId,
      targetCategoryId,
      requestedByUserId: OWNER_ID,
      destinationCategoryId: CategoryIdSchema.parse(newUlid()),
      destinationExpenseClass: 'household',
      requestedAt: AT,
      state,
    }),
  )
}

async function publishCategoryTransactionsRemapped(
  h: Harness,
  categoryDeletionRequestId: CategoryDeletionRequestId,
  affectedTransactionCount: number,
): Promise<void> {
  await h.eventBus.publish(
    CategoryTransactionsRemappedSchema.parse({
      eventId: newUlid(),
      occurredAt: AT,
      type: 'CategoryTransactionsRemapped',
      categoryDeletionRequestId,
      affectedTransactionCount,
    }),
  )
}

async function publishCategoryLearningRulesRemapped(
  h: Harness,
  categoryDeletionRequestId: CategoryDeletionRequestId,
  affectedLearningRuleCount: number,
): Promise<void> {
  await h.eventBus.publish(
    CategoryLearningRulesRemappedSchema.parse({
      eventId: newUlid(),
      occurredAt: AT,
      type: 'CategoryLearningRulesRemapped',
      categoryDeletionRequestId,
      affectedLearningRuleCount,
    }),
  )
}

async function rereadCategoryDeletion(
  h: Harness,
  categoryDeletionRequestId: CategoryDeletionRequestId,
): Promise<CategoryDeletionRequest> {
  const reread = await h.deps.categoryDeletionRequestRepository.findById(categoryDeletionRequestId)
  if (reread === null) throw new Error('カテゴリ削除リクエストが保存されていない')
  return reread
}

// --- 経費種別側の下ごしらえ ---

async function seedExpenseTypeMaster(h: Harness, name: string): Promise<ExpenseTypeId> {
  const expenseTypeId = ExpenseTypeIdSchema.parse(newUlid())
  await h.deps.expenseTypeMasterRepository.save(
    ExpenseTypeMasterSchema.parse({
      kind: 'custom',
      expenseTypeId,
      name,
      scope: { kind: 'personal', userId: OWNER_ID },
      createdAt: AT,
      createdByUserId: OWNER_ID,
      renameHistory: [],
    }),
  )
  return expenseTypeId
}

async function seedMonthlyLimit(h: Harness, expenseTypeId: ExpenseTypeId): Promise<void> {
  await h.deps.monthlyLimitRepository.save(
    MonthlyLimitSchema.parse({
      kind: 'capped',
      monthlyLimitId: MonthlyLimitIdSchema.parse(newUlid()),
      userId: OWNER_ID,
      expenseTypeId,
      effectiveFrom: AT,
      capAmount: 10000,
      changeHistory: [],
    }),
  )
}

/** リマップ依頼済み（経費精算・自動分類の 2 コンテキスト待ち）の経費種別削除リクエストを保存する */
async function seedRemapRequestedExpenseTypeDeletion(
  h: Harness,
  targetExpenseTypeId: ExpenseTypeId,
): Promise<ExpenseTypeDeletionRequestId> {
  const expenseTypeDeletionRequestId = ExpenseTypeDeletionRequestIdSchema.parse(newUlid())
  const pending = ExpenseTypeDeletionRequestSchema.parse({
    expenseTypeDeletionRequestId,
    targetExpenseTypeId,
    requestedByUserId: OWNER_ID,
    destinationExpenseTypeId: ExpenseTypeIdSchema.parse(newUlid()),
    requestedAt: AT,
    state: { kind: 'pending_remap' },
  }) as PendingRemapExpenseTypeDeletionRequest
  const requested = requestExpenseTypeRemap(
    pending,
    ['expense_settlement', 'auto_classification'],
    AT,
  )
  await h.deps.expenseTypeDeletionRequestRepository.save(requested)
  return expenseTypeDeletionRequestId
}

async function publishExpenseTypeTransactionsRemapped(
  h: Harness,
  expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestId,
  affectedTransactionCount: number,
): Promise<void> {
  await h.eventBus.publish(
    ExpenseTypeTransactionsRemappedSchema.parse({
      eventId: newUlid(),
      occurredAt: AT,
      type: 'ExpenseTypeTransactionsRemapped',
      expenseTypeDeletionRequestId,
      affectedTransactionCount,
    }),
  )
}

async function publishExpenseTypeLearningRulesRemapped(
  h: Harness,
  expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestId,
  affectedLearningRuleCount: number,
): Promise<void> {
  await h.eventBus.publish(
    ExpenseTypeLearningRulesRemappedSchema.parse({
      eventId: newUlid(),
      occurredAt: AT,
      type: 'ExpenseTypeLearningRulesRemapped',
      expenseTypeDeletionRequestId,
      affectedLearningRuleCount,
    }),
  )
}

async function rereadExpenseTypeDeletion(
  h: Harness,
  expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestId,
): Promise<ExpenseTypeDeletionRequest> {
  const reread = await h.deps.expenseTypeDeletionRequestRepository.findById(
    expenseTypeDeletionRequestId,
  )
  if (reread === null) throw new Error('経費種別削除リクエストが保存されていない')
  return reread
}

describe('registerMasterDataDeletionCoordinator: カテゴリ削除', () => {
  it('依頼した全コンテキストの完了通知が揃うと、マスタを物理削除し合算件数つきの完了イベントを1件発行する', async () => {
    const h = createHarness()
    const target = await seedCategoryMaster(h, '推し活')
    const requestId = await seedRemapRequestedCategoryDeletion(h, target)

    // 完了イベントは物理削除の後に発行される（購読時点の状態が順序の証拠になる）
    const masterAtPublish: (boolean | null)[] = []
    h.eventBus.subscribe<CategoryDeletionCompleted>('CategoryDeletionCompleted', async () => {
      masterAtPublish.push((await h.deps.categoryMasterRepository.findById(target)) === null)
    })

    await publishCategoryTransactionsRemapped(h, requestId, 3)
    await publishCategoryLearningRulesRemapped(h, requestId, 2)

    expect(await h.deps.categoryMasterRepository.findById(target)).toBeNull()
    expect(h.categoryCompleted).toHaveLength(1)
    expect(h.categoryCompleted[0]?.categoryDeletionRequestId).toBe(requestId)
    expect(h.categoryCompleted[0]?.affectedTransactionCount).toBe(3)
    expect(h.categoryCompleted[0]?.affectedLearningRuleCount).toBe(2)
    expect(masterAtPublish).toEqual([true])

    const reread = await rereadCategoryDeletion(h, requestId)
    expect(reread.state.kind).toBe('remap_completed')
    if (reread.state.kind !== 'remap_completed') throw new Error('remap_completed を期待')
    expect(reread.state.affectedTransactionCount).toBe(3)
    expect(reread.state.affectedLearningRuleCount).toBe(2)
  })

  it('片方のコンテキストの完了通知だけではマスタを消さず、完了イベントも発行しない', async () => {
    const h = createHarness()
    const target = await seedCategoryMaster(h, '推し活')
    const requestId = await seedRemapRequestedCategoryDeletion(h, target)

    await publishCategoryTransactionsRemapped(h, requestId, 3)

    expect(await h.deps.categoryMasterRepository.findById(target)).not.toBeNull()
    expect(h.categoryCompleted).toHaveLength(0)
    // 完了記録は残る（残る 1 コンテキストが返れば削除へ進める）
    const reread = await rereadCategoryDeletion(h, requestId)
    expect(reread.state.kind).toBe('remap_requested')
    if (reread.state.kind !== 'remap_requested') throw new Error('remap_requested を期待')
    expect(reread.state.completedContexts.map(c => c.context)).toEqual(['household_analysis'])
  })

  it('同一コンテキストの完了通知が再配信されても二重に記録せず、揃っていない扱いのまま', async () => {
    const h = createHarness()
    const target = await seedCategoryMaster(h, '推し活')
    const requestId = await seedRemapRequestedCategoryDeletion(h, target)

    await publishCategoryTransactionsRemapped(h, requestId, 3)
    // 再配信では件数 0 で届く（付け替え対象が既に無いため）。上書きしてしまうと合算が静かに減る
    await publishCategoryTransactionsRemapped(h, requestId, 0)

    expect(h.categoryCompleted).toHaveLength(0)
    expect(await h.deps.categoryMasterRepository.findById(target)).not.toBeNull()
    const reread = await rereadCategoryDeletion(h, requestId)
    if (reread.state.kind !== 'remap_requested') throw new Error('remap_requested を期待')
    expect(reread.state.completedContexts).toHaveLength(1)
    expect(reread.state.completedContexts[0]?.affectedTransactionCount).toBe(3)
  })

  it('完了済みリクエストへの完了通知は無視する（完了イベントも件数も増えない）', async () => {
    const h = createHarness()
    const target = await seedCategoryMaster(h, '推し活')
    const requestId = await seedRemapRequestedCategoryDeletion(h, target)
    await publishCategoryTransactionsRemapped(h, requestId, 3)
    await publishCategoryLearningRulesRemapped(h, requestId, 2)
    expect(h.categoryCompleted).toHaveLength(1)

    // 完了後に同じ完了通知が再配信される（at-least-once 配信）
    await publishCategoryTransactionsRemapped(h, requestId, 0)
    await publishCategoryLearningRulesRemapped(h, requestId, 0)

    expect(h.categoryCompleted).toHaveLength(1)
    const reread = await rereadCategoryDeletion(h, requestId)
    if (reread.state.kind !== 'remap_completed') throw new Error('remap_completed を期待')
    expect(reread.state.affectedTransactionCount).toBe(3)
    expect(reread.state.affectedLearningRuleCount).toBe(2)
  })

  it('失敗済みリクエストへの完了通知は無視する（マスタを消さない）', async () => {
    const h = createHarness()
    const target = await seedCategoryMaster(h, '推し活')
    const requestId = CategoryDeletionRequestIdSchema.parse(newUlid())
    await saveCategoryDeletionWithState(h, requestId, target, {
      kind: 'remap_failed',
      failedAt: AT,
      failureDetail: '学習ルールストア障害',
    })

    await publishCategoryTransactionsRemapped(h, requestId, 3)
    await publishCategoryLearningRulesRemapped(h, requestId, 2)

    expect(await h.deps.categoryMasterRepository.findById(target)).not.toBeNull()
    expect(h.categoryCompleted).toHaveLength(0)
    expect((await rereadCategoryDeletion(h, requestId)).state.kind).toBe('remap_failed')
  })

  it('リマップ未依頼のリクエストへの完了通知は無視する（マスタを消さない）', async () => {
    const h = createHarness()
    const target = await seedCategoryMaster(h, '推し活')
    const requestId = CategoryDeletionRequestIdSchema.parse(newUlid())
    await saveCategoryDeletionWithState(h, requestId, target, { kind: 'pending_remap' })

    await publishCategoryTransactionsRemapped(h, requestId, 3)
    await publishCategoryLearningRulesRemapped(h, requestId, 2)

    expect(await h.deps.categoryMasterRepository.findById(target)).not.toBeNull()
    expect(h.categoryCompleted).toHaveLength(0)
    expect((await rereadCategoryDeletion(h, requestId)).state.kind).toBe('pending_remap')
  })

  it('存在しないリクエストへの完了通知は例外にせず無視する', async () => {
    const h = createHarness()
    const unknownId = CategoryDeletionRequestIdSchema.parse(newUlid())

    await expect(publishCategoryTransactionsRemapped(h, unknownId, 3)).resolves.toBeUndefined()
    expect(h.categoryCompleted).toHaveLength(0)
  })
})

describe('registerMasterDataDeletionCoordinator: 経費種別削除', () => {
  it('依頼した全コンテキストの完了通知が揃うと、月次上限とマスタを物理削除し完了イベントを1件発行する', async () => {
    const h = createHarness()
    const target = await seedExpenseTypeMaster(h, 'セミナー')
    await seedMonthlyLimit(h, target)
    const requestId = await seedRemapRequestedExpenseTypeDeletion(h, target)

    const stateAtPublish: { masterDeleted: boolean; limitDeleted: boolean }[] = []
    h.eventBus.subscribe<ExpenseTypeDeletionCompleted>('ExpenseTypeDeletionCompleted', async () => {
      stateAtPublish.push({
        masterDeleted: (await h.deps.expenseTypeMasterRepository.findById(target)) === null,
        limitDeleted:
          (await h.deps.monthlyLimitRepository.findByUserAndExpenseType(OWNER_ID, target)) === null,
      })
    })

    await publishExpenseTypeTransactionsRemapped(h, requestId, 1)
    await publishExpenseTypeLearningRulesRemapped(h, requestId, 2)

    expect(await h.deps.expenseTypeMasterRepository.findById(target)).toBeNull()
    // 削除対象経費種別の月次上限は宙に浮くため一緒に消す
    expect(
      await h.deps.monthlyLimitRepository.findByUserAndExpenseType(OWNER_ID, target),
    ).toBeNull()
    expect(h.expenseTypeCompleted).toHaveLength(1)
    expect(h.expenseTypeCompleted[0]?.expenseTypeDeletionRequestId).toBe(requestId)
    expect(h.expenseTypeCompleted[0]?.affectedTransactionCount).toBe(1)
    expect(h.expenseTypeCompleted[0]?.affectedLearningRuleCount).toBe(2)
    expect(stateAtPublish).toEqual([{ masterDeleted: true, limitDeleted: true }])

    const reread = await rereadExpenseTypeDeletion(h, requestId)
    if (reread.state.kind !== 'remap_completed') throw new Error('remap_completed を期待')
    expect(reread.state.affectedTransactionCount).toBe(1)
    expect(reread.state.affectedLearningRuleCount).toBe(2)
  })

  it('片方のコンテキストの完了通知だけではマスタも月次上限も消さない', async () => {
    const h = createHarness()
    const target = await seedExpenseTypeMaster(h, 'セミナー')
    await seedMonthlyLimit(h, target)
    const requestId = await seedRemapRequestedExpenseTypeDeletion(h, target)

    await publishExpenseTypeLearningRulesRemapped(h, requestId, 2)

    expect(await h.deps.expenseTypeMasterRepository.findById(target)).not.toBeNull()
    expect(
      await h.deps.monthlyLimitRepository.findByUserAndExpenseType(OWNER_ID, target),
    ).not.toBeNull()
    expect(h.expenseTypeCompleted).toHaveLength(0)
    const reread = await rereadExpenseTypeDeletion(h, requestId)
    if (reread.state.kind !== 'remap_requested') throw new Error('remap_requested を期待')
    expect(reread.state.completedContexts.map(c => c.context)).toEqual(['auto_classification'])
  })

  it('同一コンテキストの完了通知が再配信されても二重に記録しない', async () => {
    const h = createHarness()
    const target = await seedExpenseTypeMaster(h, 'セミナー')
    const requestId = await seedRemapRequestedExpenseTypeDeletion(h, target)

    await publishExpenseTypeLearningRulesRemapped(h, requestId, 2)
    await publishExpenseTypeLearningRulesRemapped(h, requestId, 0)

    expect(h.expenseTypeCompleted).toHaveLength(0)
    const reread = await rereadExpenseTypeDeletion(h, requestId)
    if (reread.state.kind !== 'remap_requested') throw new Error('remap_requested を期待')
    expect(reread.state.completedContexts).toHaveLength(1)
    expect(reread.state.completedContexts[0]?.affectedLearningRuleCount).toBe(2)
  })

  it('完了済みリクエストへの完了通知は無視する（完了イベントも件数も増えない）', async () => {
    const h = createHarness()
    const target = await seedExpenseTypeMaster(h, 'セミナー')
    const requestId = await seedRemapRequestedExpenseTypeDeletion(h, target)
    await publishExpenseTypeTransactionsRemapped(h, requestId, 1)
    await publishExpenseTypeLearningRulesRemapped(h, requestId, 2)
    expect(h.expenseTypeCompleted).toHaveLength(1)

    await publishExpenseTypeTransactionsRemapped(h, requestId, 0)
    await publishExpenseTypeLearningRulesRemapped(h, requestId, 0)

    expect(h.expenseTypeCompleted).toHaveLength(1)
    const reread = await rereadExpenseTypeDeletion(h, requestId)
    if (reread.state.kind !== 'remap_completed') throw new Error('remap_completed を期待')
    expect(reread.state.affectedTransactionCount).toBe(1)
    expect(reread.state.affectedLearningRuleCount).toBe(2)
  })

  it('存在しないリクエストへの完了通知は例外にせず無視する', async () => {
    const h = createHarness()
    const unknownId = ExpenseTypeDeletionRequestIdSchema.parse(newUlid())

    await expect(publishExpenseTypeLearningRulesRemapped(h, unknownId, 2)).resolves.toBeUndefined()
    expect(h.expenseTypeCompleted).toHaveLength(0)
  })
})
