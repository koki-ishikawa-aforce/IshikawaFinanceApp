/**
 * マスタ削除コーディネーターのハンドラーテスト（#223 / #431）
 *
 * コーディネーターの守り（全コンテキストの完了通知が揃ってはじめて物理削除する・
 * 完了済み / 失敗済み / リマップ未依頼のリクエストへの通知は無視する）を、HTTP ルートを介さずに
 * registerMasterDataDeletionCoordinator を直接呼んで検証する。
 *
 * ルート経由でしか確かめられないと、完了通知が揃わない状況を作るために
 * 購読の解除や保存処理の差し替えといった細工が要り、テストが実装の都合
 * （保存の呼び出し回数など）に依存する。ここでは各コンテキストの完了通知イベントを
 * 直接 publish するだけで、揃う / 揃わないの両方を素朴に作れる。
 */
import { describe, it, expect, vi } from 'vitest'
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
  failCategoryRemap,
  failExpenseTypeRemap,
  requestCategoryRemap,
  requestExpenseTypeRemap,
} from '@warimaru/domain'
import type {
  CategoryDeletionCompleted,
  CategoryDeletionRequest,
  CategoryDeletionRequestId,
  CategoryId,
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
import type { MasterDataDeletionCoordinatorDeps } from '../../src/event-handlers/master-data-deletion-coordinator.js'
import { domainEventBase } from '../../src/event-handlers/event-base.js'

const OWNER_ID: UserId = UserIdSchema.parse('user-honey-test')
const AT = new Date('2026-07-10T00:00:00Z')

interface Harness {
  eventBus: InMemoryEventBus
  deps: MasterDataDeletionCoordinatorDeps
  /** コーディネーターが発行した削除完了イベント（発行時点の外部状態つき） */
  categoryCompleted: CategoryDeletionCompleted[]
  expenseTypeCompleted: ExpenseTypeDeletionCompleted[]
}

function createCoordinatorDeps(): MasterDataDeletionCoordinatorDeps {
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
  const deps = createCoordinatorDeps()
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

function pendingCategoryDeletion(
  categoryDeletionRequestId: CategoryDeletionRequestId,
  targetCategoryId: CategoryId,
): PendingRemapCategoryDeletionRequest {
  return CategoryDeletionRequestSchema.parse({
    categoryDeletionRequestId,
    targetCategoryId,
    requestedByUserId: OWNER_ID,
    destinationCategoryId: CategoryIdSchema.parse(newUlid()),
    destinationExpenseClass: 'household',
    requestedAt: AT,
    state: { kind: 'pending_remap' },
  }) as PendingRemapCategoryDeletionRequest
}

/** リマップ依頼済み（家計分析・自動分類の 2 コンテキスト待ち）のカテゴリ削除リクエストを保存する */
async function seedRemapRequestedCategoryDeletion(
  h: Harness,
  targetCategoryId: CategoryId,
): Promise<CategoryDeletionRequestId> {
  const categoryDeletionRequestId = CategoryDeletionRequestIdSchema.parse(newUlid())
  const requested = requestCategoryRemap(
    pendingCategoryDeletion(categoryDeletionRequestId, targetCategoryId),
    ['household_analysis', 'auto_classification'],
    AT,
  )
  await h.deps.categoryDeletionRequestRepository.save(requested)
  return categoryDeletionRequestId
}

/**
 * 家計分析だけへ依頼したカテゴリ削除リクエストを保存する
 * （依頼していない自動分類からの完了通知を作るため）。
 */
async function seedRemapRequestedToHouseholdOnlyCategoryDeletion(
  h: Harness,
  targetCategoryId: CategoryId,
): Promise<CategoryDeletionRequestId> {
  const categoryDeletionRequestId = CategoryDeletionRequestIdSchema.parse(newUlid())
  const requested = requestCategoryRemap(
    pendingCategoryDeletion(categoryDeletionRequestId, targetCategoryId),
    ['household_analysis'],
    AT,
  )
  await h.deps.categoryDeletionRequestRepository.save(requested)
  return categoryDeletionRequestId
}

/** リマップ未依頼のままのカテゴリ削除リクエストを保存する（未依頼への通知を作るため） */
async function seedPendingRemapCategoryDeletion(
  h: Harness,
  targetCategoryId: CategoryId,
): Promise<CategoryDeletionRequestId> {
  const categoryDeletionRequestId = CategoryDeletionRequestIdSchema.parse(newUlid())
  await h.deps.categoryDeletionRequestRepository.save(
    pendingCategoryDeletion(categoryDeletionRequestId, targetCategoryId),
  )
  return categoryDeletionRequestId
}

/**
 * リマップ失敗済みのカテゴリ削除リクエストを保存する（失敗済みへの通知を作るため）。
 * 状態はドメインの遷移関数で組み立てる（スキーマへ直接与えると、
 * 実際には到達しない形の失敗状態でテストできてしまい、遷移の前提が変わっても気づけない）。
 */
async function seedRemapFailedCategoryDeletion(
  h: Harness,
  targetCategoryId: CategoryId,
): Promise<CategoryDeletionRequestId> {
  const categoryDeletionRequestId = CategoryDeletionRequestIdSchema.parse(newUlid())
  const requested = requestCategoryRemap(
    pendingCategoryDeletion(categoryDeletionRequestId, targetCategoryId),
    ['household_analysis', 'auto_classification'],
    AT,
  )
  await h.deps.categoryDeletionRequestRepository.save(
    failCategoryRemap(requested, '学習ルールストア障害', AT),
  )
  return categoryDeletionRequestId
}

async function publishCategoryTransactionsRemapped(
  h: Harness,
  categoryDeletionRequestId: CategoryDeletionRequestId,
  affectedTransactionCount: number,
): Promise<void> {
  await h.eventBus.publish(
    CategoryTransactionsRemappedSchema.parse({
      ...domainEventBase(AT),
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
      ...domainEventBase(AT),
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

function pendingExpenseTypeDeletion(
  expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestId,
  targetExpenseTypeId: ExpenseTypeId,
): PendingRemapExpenseTypeDeletionRequest {
  return ExpenseTypeDeletionRequestSchema.parse({
    expenseTypeDeletionRequestId,
    targetExpenseTypeId,
    requestedByUserId: OWNER_ID,
    destinationExpenseTypeId: ExpenseTypeIdSchema.parse(newUlid()),
    requestedAt: AT,
    state: { kind: 'pending_remap' },
  }) as PendingRemapExpenseTypeDeletionRequest
}

/** リマップ依頼済み（経費精算・自動分類の 2 コンテキスト待ち）の経費種別削除リクエストを保存する */
async function seedRemapRequestedExpenseTypeDeletion(
  h: Harness,
  targetExpenseTypeId: ExpenseTypeId,
): Promise<ExpenseTypeDeletionRequestId> {
  const expenseTypeDeletionRequestId = ExpenseTypeDeletionRequestIdSchema.parse(newUlid())
  const requested = requestExpenseTypeRemap(
    pendingExpenseTypeDeletion(expenseTypeDeletionRequestId, targetExpenseTypeId),
    ['expense_settlement', 'auto_classification'],
    AT,
  )
  await h.deps.expenseTypeDeletionRequestRepository.save(requested)
  return expenseTypeDeletionRequestId
}

/**
 * 経費精算だけへ依頼した経費種別削除リクエストを保存する
 * （依頼していない自動分類からの完了通知を作るため）。
 */
async function seedRemapRequestedToSettlementOnlyExpenseTypeDeletion(
  h: Harness,
  targetExpenseTypeId: ExpenseTypeId,
): Promise<ExpenseTypeDeletionRequestId> {
  const expenseTypeDeletionRequestId = ExpenseTypeDeletionRequestIdSchema.parse(newUlid())
  const requested = requestExpenseTypeRemap(
    pendingExpenseTypeDeletion(expenseTypeDeletionRequestId, targetExpenseTypeId),
    ['expense_settlement'],
    AT,
  )
  await h.deps.expenseTypeDeletionRequestRepository.save(requested)
  return expenseTypeDeletionRequestId
}

/** リマップ未依頼のままの経費種別削除リクエストを保存する */
async function seedPendingRemapExpenseTypeDeletion(
  h: Harness,
  targetExpenseTypeId: ExpenseTypeId,
): Promise<ExpenseTypeDeletionRequestId> {
  const expenseTypeDeletionRequestId = ExpenseTypeDeletionRequestIdSchema.parse(newUlid())
  await h.deps.expenseTypeDeletionRequestRepository.save(
    pendingExpenseTypeDeletion(expenseTypeDeletionRequestId, targetExpenseTypeId),
  )
  return expenseTypeDeletionRequestId
}

/** リマップ失敗済みの経費種別削除リクエストを保存する（状態はドメインの遷移関数で組み立てる） */
async function seedRemapFailedExpenseTypeDeletion(
  h: Harness,
  targetExpenseTypeId: ExpenseTypeId,
): Promise<ExpenseTypeDeletionRequestId> {
  const expenseTypeDeletionRequestId = ExpenseTypeDeletionRequestIdSchema.parse(newUlid())
  const requested = requestExpenseTypeRemap(
    pendingExpenseTypeDeletion(expenseTypeDeletionRequestId, targetExpenseTypeId),
    ['expense_settlement', 'auto_classification'],
    AT,
  )
  await h.deps.expenseTypeDeletionRequestRepository.save(
    failExpenseTypeRemap(requested, '学習ルールストア障害', AT),
  )
  return expenseTypeDeletionRequestId
}

async function publishExpenseTypeTransactionsRemapped(
  h: Harness,
  expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestId,
  affectedTransactionCount: number,
): Promise<void> {
  await h.eventBus.publish(
    ExpenseTypeTransactionsRemappedSchema.parse({
      ...domainEventBase(AT),
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
      ...domainEventBase(AT),
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

    // 「完了の記録 → マスタの物理削除 → 完了イベントの発行」の順序を、各時点の状態で固定する。
    // 記録より先に消すと、その間に落ちたときに「マスタは消えたのに完了が記録されていない」が残り、
    // 発行より先に消さないと、完了の合図を受け取った側が消えたはずのマスタを見る。
    // ここでの差し替えは失敗の模擬ではなく、途中の時点を覗くための観測に限る
    const requestStateAtDeletion: string[] = []
    const originalDeleteById = h.deps.categoryMasterRepository.deleteById.bind(
      h.deps.categoryMasterRepository,
    )
    h.deps.categoryMasterRepository.deleteById = async id => {
      requestStateAtDeletion.push((await rereadCategoryDeletion(h, requestId)).state.kind)
      return originalDeleteById(id)
    }
    const stateAtPublish: { masterDeleted: boolean; requestState: string }[] = []
    h.eventBus.subscribe<CategoryDeletionCompleted>('CategoryDeletionCompleted', async () => {
      stateAtPublish.push({
        masterDeleted: (await h.deps.categoryMasterRepository.findById(target)) === null,
        requestState: (await rereadCategoryDeletion(h, requestId)).state.kind,
      })
    })

    await publishCategoryTransactionsRemapped(h, requestId, 3)
    await publishCategoryLearningRulesRemapped(h, requestId, 2)

    expect(await h.deps.categoryMasterRepository.findById(target)).toBeNull()
    expect(h.categoryCompleted).toHaveLength(1)
    expect(h.categoryCompleted[0]?.categoryDeletionRequestId).toBe(requestId)
    expect(h.categoryCompleted[0]?.affectedTransactionCount).toBe(3)
    expect(h.categoryCompleted[0]?.affectedLearningRuleCount).toBe(2)
    expect(requestStateAtDeletion).toEqual(['remap_completed'])
    expect(stateAtPublish).toEqual([{ masterDeleted: true, requestState: 'remap_completed' }])

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
    // 付け替えが途中で失敗し、マスタを残すと決めたリクエストに、遅れて完了通知が届く状況
    const requestId = await seedRemapFailedCategoryDeletion(h, target)

    await publishCategoryTransactionsRemapped(h, requestId, 3)
    await publishCategoryLearningRulesRemapped(h, requestId, 2)

    expect(await h.deps.categoryMasterRepository.findById(target)).not.toBeNull()
    expect(h.categoryCompleted).toHaveLength(0)
    expect((await rereadCategoryDeletion(h, requestId)).state.kind).toBe('remap_failed')
  })

  it('リマップ未依頼のリクエストへの完了通知は無視する（マスタを消さない）', async () => {
    const h = createHarness()
    const target = await seedCategoryMaster(h, '推し活')
    const requestId = await seedPendingRemapCategoryDeletion(h, target)

    await publishCategoryTransactionsRemapped(h, requestId, 3)
    await publishCategoryLearningRulesRemapped(h, requestId, 2)

    expect(await h.deps.categoryMasterRepository.findById(target)).not.toBeNull()
    expect(h.categoryCompleted).toHaveLength(0)
    expect((await rereadCategoryDeletion(h, requestId)).state.kind).toBe('pending_remap')
  })

  it('依頼していないコンテキストからの完了通知は記録せず、無言で捨てずにログへ残す', async () => {
    const h = createHarness()
    const target = await seedCategoryMaster(h, '推し活')
    // 家計分析にだけ付け替えを依頼したのに、依頼していない自動分類が完了を申告してくる状況
    const requestId = await seedRemapRequestedToHouseholdOnlyCategoryDeletion(h, target)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await publishCategoryLearningRulesRemapped(h, requestId, 9)

      const reread = await rereadCategoryDeletion(h, requestId)
      if (reread.state.kind !== 'remap_requested') throw new Error('remap_requested を期待')
      expect(reread.state.completedContexts).toEqual([])
      expect(await h.deps.categoryMasterRepository.findById(target)).not.toBeNull()
      expect(h.categoryCompleted).toHaveLength(0)
      // 影響件数が実際より小さいだけの完了記録に紛れないよう、申告元が記録に残る
      expect(errorLog).toHaveBeenCalledTimes(1)
      expect(String(errorLog.mock.calls[0]?.[0])).toContain('auto_classification')

      // 依頼した家計分析の完了通知は従来どおり記録され、削除まで進む
      await publishCategoryTransactionsRemapped(h, requestId, 3)
      expect(await h.deps.categoryMasterRepository.findById(target)).toBeNull()
      expect(h.categoryCompleted).toHaveLength(1)
      expect(h.categoryCompleted[0]?.affectedTransactionCount).toBe(3)
      expect(h.categoryCompleted[0]?.affectedLearningRuleCount).toBe(0)
    } finally {
      errorLog.mockRestore()
    }
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

    const stateAtPublish: {
      masterDeleted: boolean
      limitDeleted: boolean
      requestState: string
    }[] = []
    h.eventBus.subscribe<ExpenseTypeDeletionCompleted>('ExpenseTypeDeletionCompleted', async () => {
      stateAtPublish.push({
        masterDeleted: (await h.deps.expenseTypeMasterRepository.findById(target)) === null,
        limitDeleted:
          (await h.deps.monthlyLimitRepository.findByUserAndExpenseType(OWNER_ID, target)) === null,
        requestState: (await rereadExpenseTypeDeletion(h, requestId)).state.kind,
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
    expect(stateAtPublish).toEqual([
      { masterDeleted: true, limitDeleted: true, requestState: 'remap_completed' },
    ])

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
    await seedMonthlyLimit(h, target)
    const requestId = await seedRemapRequestedExpenseTypeDeletion(h, target)

    await publishExpenseTypeLearningRulesRemapped(h, requestId, 2)
    await publishExpenseTypeLearningRulesRemapped(h, requestId, 0)

    expect(h.expenseTypeCompleted).toHaveLength(0)
    expect(await h.deps.expenseTypeMasterRepository.findById(target)).not.toBeNull()
    expect(
      await h.deps.monthlyLimitRepository.findByUserAndExpenseType(OWNER_ID, target),
    ).not.toBeNull()
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

  it('失敗済みリクエストへの完了通知は無視する（マスタも月次上限も消さない）', async () => {
    const h = createHarness()
    const target = await seedExpenseTypeMaster(h, 'セミナー')
    await seedMonthlyLimit(h, target)
    // 付け替えが途中で失敗し、マスタを残すと決めたリクエストに、遅れて完了通知が届く状況
    const requestId = await seedRemapFailedExpenseTypeDeletion(h, target)

    await publishExpenseTypeTransactionsRemapped(h, requestId, 1)
    await publishExpenseTypeLearningRulesRemapped(h, requestId, 2)

    expect(await h.deps.expenseTypeMasterRepository.findById(target)).not.toBeNull()
    expect(
      await h.deps.monthlyLimitRepository.findByUserAndExpenseType(OWNER_ID, target),
    ).not.toBeNull()
    expect(h.expenseTypeCompleted).toHaveLength(0)
    expect((await rereadExpenseTypeDeletion(h, requestId)).state.kind).toBe('remap_failed')
  })

  it('リマップ未依頼のリクエストへの完了通知は無視する（マスタも月次上限も消さない）', async () => {
    const h = createHarness()
    const target = await seedExpenseTypeMaster(h, 'セミナー')
    await seedMonthlyLimit(h, target)
    const requestId = await seedPendingRemapExpenseTypeDeletion(h, target)

    await publishExpenseTypeTransactionsRemapped(h, requestId, 1)
    await publishExpenseTypeLearningRulesRemapped(h, requestId, 2)

    expect(await h.deps.expenseTypeMasterRepository.findById(target)).not.toBeNull()
    expect(
      await h.deps.monthlyLimitRepository.findByUserAndExpenseType(OWNER_ID, target),
    ).not.toBeNull()
    expect(h.expenseTypeCompleted).toHaveLength(0)
    expect((await rereadExpenseTypeDeletion(h, requestId)).state.kind).toBe('pending_remap')
  })

  it('依頼していないコンテキストからの完了通知は記録せず、無言で捨てずにログへ残す', async () => {
    const h = createHarness()
    const target = await seedExpenseTypeMaster(h, 'セミナー')
    await seedMonthlyLimit(h, target)
    // 経費精算にだけ付け替えを依頼したのに、依頼していない自動分類が完了を申告してくる状況
    const requestId = await seedRemapRequestedToSettlementOnlyExpenseTypeDeletion(h, target)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await publishExpenseTypeLearningRulesRemapped(h, requestId, 9)

      const reread = await rereadExpenseTypeDeletion(h, requestId)
      if (reread.state.kind !== 'remap_requested') throw new Error('remap_requested を期待')
      expect(reread.state.completedContexts).toEqual([])
      expect(await h.deps.expenseTypeMasterRepository.findById(target)).not.toBeNull()
      expect(h.expenseTypeCompleted).toHaveLength(0)
      expect(errorLog).toHaveBeenCalledTimes(1)
      expect(String(errorLog.mock.calls[0]?.[0])).toContain('auto_classification')

      // 依頼した経費精算の完了通知は従来どおり記録され、削除まで進む
      await publishExpenseTypeTransactionsRemapped(h, requestId, 1)
      expect(await h.deps.expenseTypeMasterRepository.findById(target)).toBeNull()
      expect(h.expenseTypeCompleted).toHaveLength(1)
      expect(h.expenseTypeCompleted[0]?.affectedTransactionCount).toBe(1)
      expect(h.expenseTypeCompleted[0]?.affectedLearningRuleCount).toBe(0)
    } finally {
      errorLog.mockRestore()
    }
  })

  it('存在しないリクエストへの完了通知は例外にせず無視する', async () => {
    const h = createHarness()
    const unknownId = ExpenseTypeDeletionRequestIdSchema.parse(newUlid())

    await expect(publishExpenseTypeLearningRulesRemapped(h, unknownId, 2)).resolves.toBeUndefined()
    expect(h.expenseTypeCompleted).toHaveLength(0)
  })
})
