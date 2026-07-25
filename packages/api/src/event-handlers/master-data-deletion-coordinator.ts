import {
  CategoryDeletionCompletedSchema,
  ExpenseTypeDeletionCompletedSchema,
  completeCategoryRemap,
  completeExpenseTypeRemap,
  isCategoryRemapFullyCompleted,
  isExpenseTypeRemapFullyCompleted,
  recordCategoryRemapContextCompletion,
  recordExpenseTypeRemapContextCompletion,
} from '@warimaru/domain'
import type {
  CategoryDeletionRequestId,
  CategoryDeletionRequestRepository,
  CategoryLearningRulesRemapped,
  CategoryMasterRepository,
  CategoryTransactionsRemapped,
  CompletedRemapContext,
  EventBus,
  ExpenseTypeDeletionRequestId,
  ExpenseTypeDeletionRequestRepository,
  ExpenseTypeLearningRulesRemapped,
  ExpenseTypeMasterRepository,
  ExpenseTypeTransactionsRemapped,
  MonthlyLimitRepository,
  RemapRequestedCategoryDeletionRequest,
  RemapRequestedExpenseTypeDeletionRequest,
} from '@warimaru/domain'
import { domainEventBase } from './event-base.js'

export interface MasterDataDeletionCoordinatorDeps {
  categoryMasterRepository: CategoryMasterRepository
  expenseTypeMasterRepository: ExpenseTypeMasterRepository
  monthlyLimitRepository: MonthlyLimitRepository
  categoryDeletionRequestRepository: CategoryDeletionRequestRepository
  expenseTypeDeletionRequestRepository: ExpenseTypeDeletionRequestRepository
}

type CompletionInput = Omit<CompletedRemapContext, 'completedAt'>

/**
 * マスタ削除コーディネーター（#223: 08h §2「リマップ完了を受け取る」）
 *
 * 各コンテキストの「付け替え完了」通知イベントを購読し、削除リクエストへ完了を記録する。
 * 依頼先コンテキストが全て出そろってはじめて物理削除を実行し、削除完了イベントを発行する。
 * 1つでも完了しなければ物理削除されない（要請元のルートが失敗時に remap_failed へ遷移させる）。
 *
 * 冪等: 完了記録は同一コンテキストの再通知を無視し（record 側で保証）、
 * 既に remap_requested でない（完了済み / 失敗済み）リクエストは以降の通知を無視する。
 *
 * safeSubscribe を使わない: 物理削除の失敗は要請元へ伝播させ remap_failed に倒す。
 */
export function registerMasterDataDeletionCoordinator(
  eventBus: EventBus,
  deps: MasterDataDeletionCoordinatorDeps,
): void {
  async function recordCategoryCompletion(
    categoryDeletionRequestId: CategoryDeletionRequestId,
    completion: CompletionInput,
    at: Date,
  ): Promise<void> {
    const request = await deps.categoryDeletionRequestRepository.findById(categoryDeletionRequestId)
    // remap_requested 以外（未依頼 / 完了済み / 失敗済み）への完了通知は無視する（冪等）
    if (request === null || request.state.kind !== 'remap_requested') return
    const requested = request as RemapRequestedCategoryDeletionRequest

    const recorded = recordCategoryRemapContextCompletion(requested, completion, at)
    await deps.categoryDeletionRequestRepository.save(recorded)
    if (!isCategoryRemapFullyCompleted(recorded)) return

    const completed = completeCategoryRemap(recorded, at)
    await deps.categoryDeletionRequestRepository.save(completed)
    await deps.categoryMasterRepository.deleteById(completed.targetCategoryId)
    await eventBus.publish(
      CategoryDeletionCompletedSchema.parse({
        ...domainEventBase(at),
        type: 'CategoryDeletionCompleted',
        categoryDeletionRequestId,
        affectedTransactionCount: completed.state.affectedTransactionCount,
        affectedLearningRuleCount: completed.state.affectedLearningRuleCount,
      }),
    )
  }

  async function recordExpenseTypeCompletion(
    expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestId,
    completion: CompletionInput,
    at: Date,
  ): Promise<void> {
    const request = await deps.expenseTypeDeletionRequestRepository.findById(
      expenseTypeDeletionRequestId,
    )
    if (request === null || request.state.kind !== 'remap_requested') return
    const requested = request as RemapRequestedExpenseTypeDeletionRequest

    const recorded = recordExpenseTypeRemapContextCompletion(requested, completion, at)
    await deps.expenseTypeDeletionRequestRepository.save(recorded)
    if (!isExpenseTypeRemapFullyCompleted(recorded)) return

    const completed = completeExpenseTypeRemap(recorded, at)
    await deps.expenseTypeDeletionRequestRepository.save(completed)
    // 削除対象経費種別の月次上限は残すと宙に浮くため物理削除する
    await deps.monthlyLimitRepository.deleteByExpenseType(completed.targetExpenseTypeId)
    await deps.expenseTypeMasterRepository.deleteById(completed.targetExpenseTypeId)
    await eventBus.publish(
      ExpenseTypeDeletionCompletedSchema.parse({
        ...domainEventBase(at),
        type: 'ExpenseTypeDeletionCompleted',
        expenseTypeDeletionRequestId,
        affectedTransactionCount: completed.state.affectedTransactionCount,
        affectedLearningRuleCount: completed.state.affectedLearningRuleCount,
      }),
    )
  }

  eventBus.subscribe<CategoryTransactionsRemapped>('CategoryTransactionsRemapped', event =>
    recordCategoryCompletion(
      event.categoryDeletionRequestId,
      {
        context: 'household_analysis',
        affectedTransactionCount: event.affectedTransactionCount,
        affectedLearningRuleCount: 0,
      },
      event.occurredAt,
    ),
  )

  eventBus.subscribe<CategoryLearningRulesRemapped>('CategoryLearningRulesRemapped', event =>
    recordCategoryCompletion(
      event.categoryDeletionRequestId,
      {
        context: 'auto_classification',
        affectedTransactionCount: 0,
        affectedLearningRuleCount: event.affectedLearningRuleCount,
      },
      event.occurredAt,
    ),
  )

  eventBus.subscribe<ExpenseTypeTransactionsRemapped>('ExpenseTypeTransactionsRemapped', event =>
    recordExpenseTypeCompletion(
      event.expenseTypeDeletionRequestId,
      {
        context: 'expense_settlement',
        affectedTransactionCount: event.affectedTransactionCount,
        affectedLearningRuleCount: 0,
      },
      event.occurredAt,
    ),
  )

  eventBus.subscribe<ExpenseTypeLearningRulesRemapped>('ExpenseTypeLearningRulesRemapped', event =>
    recordExpenseTypeCompletion(
      event.expenseTypeDeletionRequestId,
      {
        context: 'auto_classification',
        affectedTransactionCount: 0,
        affectedLearningRuleCount: event.affectedLearningRuleCount,
      },
      event.occurredAt,
    ),
  )
}
