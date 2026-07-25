import {
  AmazonProductKeyLearningRuleSchema,
  CategoryLearningRulesRemappedSchema,
  CategoryTransactionsRemappedSchema,
  ClassifiedDetailsSchema,
  ExpenseTypeLearningRulesRemappedSchema,
  ExpenseTypeTransactionsRemappedSchema,
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
import { domainEventBase } from './event-base.js'

export interface MasterDataRemapHandlerDeps {
  transactionRepository: TransactionRepository
  merchantLearningRuleRepository: MerchantLearningRuleRepository
  amazonProductKeyLearningRuleRepository: AmazonProductKeyLearningRuleRepository
  categoryDeletionRequestRepository: CategoryDeletionRequestRepository
  expenseTypeDeletionRequestRepository: ExpenseTypeDeletionRequestRepository
}

/**
 * マスタ削除リマップハンドラー（#89 / #223: イベント駆動リマップ）
 *
 * 削除リマップ要請イベントを購読し、コンテキストごとに付け替えを実行して
 * 「付け替え完了」通知イベントを発行する。全コンテキストの完了確認と物理削除は
 * マスタ管理のコーディネーター（master-data-deletion-coordinator）が担う。
 *
 * safeSubscribe を使わない: リマップ失敗は API ルートで remap_failed に遷移させる
 * ため、例外を呼び出し元（publish）へ伝播させる必要がある。
 *
 * 配信は at-least-once。付け替えは「対象 ID を移動先 ID へ書き換える」操作で、
 * 再配信時は対象 ID を持つ取引 / 学習ルールが既に存在しない（0 件）ため二重適用は起きない。
 */
export function registerMasterDataRemapEventHandlers(
  eventBus: EventBus,
  deps: MasterDataRemapHandlerDeps,
): void {
  // --- カテゴリ削除: 家計分析（取引のカテゴリ付け替え） ---
  eventBus.subscribe<CategoryDeletionRemapRequested>(
    'CategoryDeletionRemapRequested',
    async event => {
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

      await eventBus.publish(
        CategoryTransactionsRemappedSchema.parse({
          ...domainEventBase(event.occurredAt),
          type: 'CategoryTransactionsRemapped',
          categoryDeletionRequestId: event.categoryDeletionRequestId,
          affectedTransactionCount: transactions.length,
        }),
      )
    },
  )

  // --- カテゴリ削除: 自動分類・学習（学習ルールのカテゴリ軸付け替え） ---
  eventBus.subscribe<CategoryDeletionRemapRequested>(
    'CategoryDeletionRemapRequested',
    async event => {
      const request = await deps.categoryDeletionRequestRepository.findById(
        event.categoryDeletionRequestId,
      )
      if (request === null) {
        throw new Error(`CategoryDeletionRequest not found: ${event.categoryDeletionRequestId}`)
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

      await eventBus.publish(
        CategoryLearningRulesRemappedSchema.parse({
          ...domainEventBase(event.occurredAt),
          type: 'CategoryLearningRulesRemapped',
          categoryDeletionRequestId: event.categoryDeletionRequestId,
          affectedLearningRuleCount,
        }),
      )
    },
  )

  // --- 経費種別削除: 経費精算（取引の経費種別付け替え） ---
  eventBus.subscribe<ExpenseTypeDeletionRemapRequested>(
    'ExpenseTypeDeletionRemapRequested',
    async event => {
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

      await eventBus.publish(
        ExpenseTypeTransactionsRemappedSchema.parse({
          ...domainEventBase(event.occurredAt),
          type: 'ExpenseTypeTransactionsRemapped',
          expenseTypeDeletionRequestId: event.expenseTypeDeletionRequestId,
          affectedTransactionCount: transactions.length,
        }),
      )
    },
  )

  // --- 経費種別削除: 自動分類・学習（学習ルールの経費種別軸付け替え） ---
  eventBus.subscribe<ExpenseTypeDeletionRemapRequested>(
    'ExpenseTypeDeletionRemapRequested',
    async event => {
      const request = await deps.expenseTypeDeletionRequestRepository.findById(
        event.expenseTypeDeletionRequestId,
      )
      if (request === null) {
        throw new Error(
          `ExpenseTypeDeletionRequest not found: ${event.expenseTypeDeletionRequestId}`,
        )
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

      await eventBus.publish(
        ExpenseTypeLearningRulesRemappedSchema.parse({
          ...domainEventBase(event.occurredAt),
          type: 'ExpenseTypeLearningRulesRemapped',
          expenseTypeDeletionRequestId: event.expenseTypeDeletionRequestId,
          affectedLearningRuleCount,
        }),
      )
    },
  )
}
