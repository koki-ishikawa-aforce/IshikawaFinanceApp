import {
  AmazonProductKeyLearningRuleSchema,
  ClassifiedDetailsSchema,
  MerchantLearningRuleSchema,
  TransactionSchema,
} from '@warimaru/domain'
import type {
  AmazonProductKeyLearningRuleRepository,
  CategoryDeletionRemapRequested,
  CategoryDeletionRequestRepository,
  EventBus,
  ExpenseTypeDeletionRemapRequested,
  ExpenseTypeDeletionRequestRepository,
  MerchantLearningRuleRepository,
  TransactionRepository,
} from '@warimaru/domain'

export interface RemapResults {
  affectedTransactionCount: number
  affectedLearningRuleCount: number
}

export interface MasterDataRemapHandlerDeps {
  transactionRepository: TransactionRepository
  merchantLearningRuleRepository: MerchantLearningRuleRepository
  amazonProductKeyLearningRuleRepository: AmazonProductKeyLearningRuleRepository
  categoryDeletionRequestRepository: CategoryDeletionRequestRepository
  expenseTypeDeletionRequestRepository: ExpenseTypeDeletionRequestRepository
}

type CategoryRemapEvent = CategoryDeletionRemapRequested & {
  _remapResults?: RemapResults
}

type ExpenseTypeRemapEvent = ExpenseTypeDeletionRemapRequested & {
  _remapResults?: RemapResults
}

/**
 * マスタ削除リマップハンドラー（#89: イベント駆動リマップ）
 *
 * safeSubscribe を使わない: リマップ失敗は API ルートで remap_failed
 * 状態遷移に使うため、例外を呼び出し元に伝播させる必要がある。
 */
export function registerMasterDataRemapHandlers(
  eventBus: EventBus,
  deps: MasterDataRemapHandlerDeps,
): void {
  eventBus.subscribe<CategoryRemapEvent>('CategoryDeletionRemapRequested', async event => {
    const request = await deps.categoryDeletionRequestRepository.findById(
      event.categoryDeletionRequestId,
    )
    if (request === null) {
      throw new Error(`CategoryDeletionRequest not found: ${event.categoryDeletionRequestId}`)
    }

    const transactions = await deps.transactionRepository.findClassifiedByCategory(
      event.targetCategoryId,
    )
    for (const transaction of transactions) {
      const details = ClassifiedDetailsSchema.parse({
        categoryId: event.destinationCategoryId,
        expenseClass: event.destinationExpenseClass,
        expenseTypeRef:
          event.destinationExpenseClass === 'business_expense' &&
          request.destinationExpenseTypeId !== undefined
            ? { kind: 'business', expenseTypeId: request.destinationExpenseTypeId }
            : { kind: 'non_business' },
        basis: transaction.details.basis,
      })
      await deps.transactionRepository.save(TransactionSchema.parse({ ...transaction, details }))
    }

    let affectedLearningRuleCount = 0
    const now = event.occurredAt

    const merchantRules = await deps.merchantLearningRuleRepository.findAllByUser(
      request.requestedByUserId,
    )
    for (const rule of merchantRules) {
      if (
        rule.kind !== 'active' ||
        rule.categoryRef.kind !== 'learned' ||
        rule.categoryRef.categoryId !== event.targetCategoryId
      ) {
        continue
      }
      await deps.merchantLearningRuleRepository.save(
        MerchantLearningRuleSchema.parse({
          ...rule,
          categoryRef: { kind: 'learned', categoryId: event.destinationCategoryId },
          lastUpdatedAt: now,
        }),
      )
      affectedLearningRuleCount++
    }

    const amazonRules = await deps.amazonProductKeyLearningRuleRepository.findAllByUser(
      request.requestedByUserId,
    )
    for (const rule of amazonRules) {
      if (
        rule.categoryRef.kind !== 'learned' ||
        rule.categoryRef.categoryId !== event.targetCategoryId
      ) {
        continue
      }
      await deps.amazonProductKeyLearningRuleRepository.save(
        AmazonProductKeyLearningRuleSchema.parse({
          ...rule,
          categoryRef: { kind: 'learned', categoryId: event.destinationCategoryId },
          lastUpdatedAt: now,
        }),
      )
      affectedLearningRuleCount++
    }

    if (event._remapResults) {
      event._remapResults.affectedTransactionCount = transactions.length
      event._remapResults.affectedLearningRuleCount = affectedLearningRuleCount
    }
  })

  eventBus.subscribe<ExpenseTypeRemapEvent>('ExpenseTypeDeletionRemapRequested', async event => {
    const request = await deps.expenseTypeDeletionRequestRepository.findById(
      event.expenseTypeDeletionRequestId,
    )
    if (request === null) {
      throw new Error(`ExpenseTypeDeletionRequest not found: ${event.expenseTypeDeletionRequestId}`)
    }

    const transactions = await deps.transactionRepository.findClassifiedByExpenseType(
      event.targetExpenseTypeId,
    )
    for (const transaction of transactions) {
      const details = ClassifiedDetailsSchema.parse({
        ...transaction.details,
        expenseTypeRef: { kind: 'business', expenseTypeId: event.destinationExpenseTypeId },
      })
      await deps.transactionRepository.save(TransactionSchema.parse({ ...transaction, details }))
    }

    let affectedLearningRuleCount = 0
    const now = event.occurredAt

    const merchantRules = await deps.merchantLearningRuleRepository.findAllByUser(
      request.requestedByUserId,
    )
    for (const rule of merchantRules) {
      if (
        rule.kind !== 'active' ||
        rule.expenseTypeRef.kind !== 'learned' ||
        rule.expenseTypeRef.expenseTypeId !== event.targetExpenseTypeId
      ) {
        continue
      }
      await deps.merchantLearningRuleRepository.save(
        MerchantLearningRuleSchema.parse({
          ...rule,
          expenseTypeRef: { kind: 'learned', expenseTypeId: event.destinationExpenseTypeId },
          lastUpdatedAt: now,
        }),
      )
      affectedLearningRuleCount++
    }

    const amazonRules = await deps.amazonProductKeyLearningRuleRepository.findAllByUser(
      request.requestedByUserId,
    )
    for (const rule of amazonRules) {
      if (
        rule.expenseTypeRef.kind !== 'learned' ||
        rule.expenseTypeRef.expenseTypeId !== event.targetExpenseTypeId
      ) {
        continue
      }
      await deps.amazonProductKeyLearningRuleRepository.save(
        AmazonProductKeyLearningRuleSchema.parse({
          ...rule,
          expenseTypeRef: { kind: 'learned', expenseTypeId: event.destinationExpenseTypeId },
          lastUpdatedAt: now,
        }),
      )
      affectedLearningRuleCount++
    }

    if (event._remapResults) {
      event._remapResults.affectedTransactionCount = transactions.length
      event._remapResults.affectedLearningRuleCount = affectedLearningRuleCount
    }
  })
}
