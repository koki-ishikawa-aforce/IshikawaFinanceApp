import { Hono } from 'hono'
import { z } from 'zod'
import {
  CategoryDeletionRequestIdSchema,
  CategoryDeletionRequestSchema,
  CategoryIdSchema,
  CategoryMasterSchema,
  ClassifiedDetailsSchema,
  ExpenseClassSchema,
  ExpenseTypeIdSchema,
  InvariantViolationError,
  MerchantLearningRuleSchema,
  AmazonProductKeyLearningRuleSchema,
  NotFoundError,
  PermissionDeniedError,
  TransactionSchema,
  assertCategoryNameAvailable,
  completeCategoryRemap,
  failCategoryRemap,
  renameCustomCategory,
  requestCategoryRemap,
} from '@warimaru/domain'
import type {
  AmazonProductKeyLearningRuleRepository,
  CategoryDeletionRequestRepository,
  CategoryMaster,
  CategoryMasterRepository,
  CustomCategory,
  ExpenseTypeMaster,
  ExpenseTypeMasterRepository,
  MerchantLearningRuleRepository,
  PendingRemapCategoryDeletionRequest,
  TransactionRepository,
  UserId,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'

const BodySchema = z.object({ name: z.string().min(1) })

const DeletionRequestBodySchema = z
  .object({
    destinationCategoryId: CategoryIdSchema,
    destinationExpenseClass: ExpenseClassSchema,
    destinationExpenseTypeId: ExpenseTypeIdSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (
      body.destinationExpenseClass === 'business_expense' &&
      body.destinationExpenseTypeId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '移動先費用区分が経費(会社)の場合は destinationExpenseTypeId が必須',
        path: ['destinationExpenseTypeId'],
      })
    }
    if (
      body.destinationExpenseClass !== 'business_expense' &&
      body.destinationExpenseTypeId !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '移動先費用区分が経費(会社)以外の場合は destinationExpenseTypeId を指定できない',
        path: ['destinationExpenseTypeId'],
      })
    }
  })

/** 規定カテゴリは改名・削除不可、追加カテゴリは作成者本人のみ操作可 */
function assertEditableCustomCategory(
  category: CategoryMaster,
  viewerId: UserId,
): asserts category is CustomCategory {
  if (category.kind !== 'custom') {
    throw new InvariantViolationError('規定カテゴリは改名・削除できない')
  }
  if (category.scope.kind !== 'personal' || category.scope.userId !== viewerId) {
    throw new PermissionDeniedError('他ユーザーのカテゴリは操作できない')
  }
}

/** 移動先マスタは世帯共有、または本人の個人別のみ許容する */
function assertVisibleToViewer(
  master: CategoryMaster | ExpenseTypeMaster,
  viewerId: UserId,
  label: string,
): void {
  if (master.scope.kind === 'personal' && master.scope.userId !== viewerId) {
    throw new PermissionDeniedError(`他ユーザーの${label}は移動先にできない`)
  }
}

export interface CategoriesRoutesDeps {
  categoryMasterRepository: CategoryMasterRepository
  expenseTypeMasterRepository: ExpenseTypeMasterRepository
  categoryDeletionRequestRepository: CategoryDeletionRequestRepository
  transactionRepository: TransactionRepository
  merchantLearningRuleRepository: MerchantLearningRuleRepository
  amazonProductKeyLearningRuleRepository: AmazonProductKeyLearningRuleRepository
}

export function categoriesRoutes(deps: CategoriesRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const viewerId = c.get('viewerId')
    const items = await deps.categoryMasterRepository.findAllVisibleToUser(viewerId)
    return c.json({ items })
  })

  app.post('/', async c => {
    const body = BodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    assertCategoryNameAvailable(
      await deps.categoryMasterRepository.findAllVisibleToUser(viewerId),
      body.name,
    )
    const category = CategoryMasterSchema.parse({
      kind: 'custom',
      categoryId: CategoryIdSchema.parse(newUlid()),
      name: body.name,
      scope: { kind: 'personal', userId: viewerId },
      createdAt: new Date(),
      createdByUserId: viewerId,
      renameHistory: [],
    })
    await deps.categoryMasterRepository.save(category)
    return c.json(category, 201)
  })

  app.put('/:id', async c => {
    const id = CategoryIdSchema.parse(c.req.param('id'))
    const body = BodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const category = await deps.categoryMasterRepository.findById(id)
    if (category === null) throw new NotFoundError('CategoryMaster', id)
    assertEditableCustomCategory(category, viewerId)
    assertCategoryNameAvailable(
      await deps.categoryMasterRepository.findAllVisibleToUser(viewerId),
      body.name,
      category.categoryId,
    )
    const renamed = renameCustomCategory(category, body.name, viewerId, new Date())
    await deps.categoryMasterRepository.save(renamed)
    return c.json(renamed)
  })

  /**
   * 追加カテゴリの削除リクエスト（08h §2: 受付 → リマップ依頼 → リマップ実行 → 完了 → 物理削除）。
   * リマップは同期実行し、途中失敗時は remap_failed を記録して中断する（マスタは残る）。
   */
  app.post('/:id/deletion-requests', async c => {
    const id = CategoryIdSchema.parse(c.req.param('id'))
    const body = DeletionRequestBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')

    const target = await deps.categoryMasterRepository.findById(id)
    if (target === null) throw new NotFoundError('CategoryMaster', id)
    assertEditableCustomCategory(target, viewerId)

    if (body.destinationCategoryId === target.categoryId) {
      throw new InvariantViolationError('移動先カテゴリに削除対象自身は指定できない')
    }
    const destination = await deps.categoryMasterRepository.findById(body.destinationCategoryId)
    if (destination === null) throw new NotFoundError('CategoryMaster', body.destinationCategoryId)
    assertVisibleToViewer(destination, viewerId, 'カテゴリ')

    if (body.destinationExpenseTypeId !== undefined) {
      const destinationExpenseType = await deps.expenseTypeMasterRepository.findById(
        body.destinationExpenseTypeId,
      )
      if (destinationExpenseType === null) {
        throw new NotFoundError('ExpenseTypeMaster', body.destinationExpenseTypeId)
      }
      assertVisibleToViewer(destinationExpenseType, viewerId, '経費種別')
    }

    const now = new Date()
    const pending = CategoryDeletionRequestSchema.parse({
      categoryDeletionRequestId: CategoryDeletionRequestIdSchema.parse(newUlid()),
      targetCategoryId: target.categoryId,
      requestedByUserId: viewerId,
      destinationCategoryId: body.destinationCategoryId,
      destinationExpenseClass: body.destinationExpenseClass,
      ...(body.destinationExpenseTypeId !== undefined
        ? { destinationExpenseTypeId: body.destinationExpenseTypeId }
        : {}),
      requestedAt: now,
      state: { kind: 'pending_remap' },
    }) as PendingRemapCategoryDeletionRequest
    await deps.categoryDeletionRequestRepository.save(pending)

    const requested = requestCategoryRemap(
      pending,
      ['household_analysis', 'auto_classification'],
      now,
    )
    await deps.categoryDeletionRequestRepository.save(requested)

    try {
      // 家計分析: 分類済み取引のカテゴリ・費用区分を移動先へ付け替える（basis は監査情報として保持）
      const transactions = await deps.transactionRepository.findClassifiedByCategory(
        target.categoryId,
      )
      for (const transaction of transactions) {
        const details = ClassifiedDetailsSchema.parse({
          categoryId: body.destinationCategoryId,
          expenseClass: body.destinationExpenseClass,
          expenseTypeRef:
            body.destinationExpenseClass === 'business_expense' &&
            body.destinationExpenseTypeId !== undefined
              ? { kind: 'business', expenseTypeId: body.destinationExpenseTypeId }
              : { kind: 'non_business' },
          basis: transaction.details.basis,
        })
        await deps.transactionRepository.save(TransactionSchema.parse({ ...transaction, details }))
      }

      // 自動分類・学習: 学習ルールはカテゴリ軸のみリマップする（T-2 軸独立）
      let affectedLearningRuleCount = 0
      const merchantRules = await deps.merchantLearningRuleRepository.findAllByUser(viewerId)
      for (const rule of merchantRules) {
        if (
          rule.kind !== 'active' ||
          rule.categoryRef.kind !== 'learned' ||
          rule.categoryRef.categoryId !== target.categoryId
        ) {
          continue
        }
        await deps.merchantLearningRuleRepository.save(
          MerchantLearningRuleSchema.parse({
            ...rule,
            categoryRef: { kind: 'learned', categoryId: body.destinationCategoryId },
            lastUpdatedAt: now,
          }),
        )
        affectedLearningRuleCount++
      }
      const amazonRules = await deps.amazonProductKeyLearningRuleRepository.findAllByUser(viewerId)
      for (const rule of amazonRules) {
        if (
          rule.categoryRef.kind !== 'learned' ||
          rule.categoryRef.categoryId !== target.categoryId
        ) {
          continue
        }
        await deps.amazonProductKeyLearningRuleRepository.save(
          AmazonProductKeyLearningRuleSchema.parse({
            ...rule,
            categoryRef: { kind: 'learned', categoryId: body.destinationCategoryId },
            lastUpdatedAt: now,
          }),
        )
        affectedLearningRuleCount++
      }

      const completed = completeCategoryRemap(
        requested,
        { affectedTransactionCount: transactions.length, affectedLearningRuleCount },
        new Date(),
      )
      await deps.categoryDeletionRequestRepository.save(completed)
      await deps.categoryMasterRepository.deleteById(target.categoryId)
      return c.json({ request: completed }, 201)
    } catch (e) {
      const failed = failCategoryRemap(
        requested,
        e instanceof Error ? e.message : String(e),
        new Date(),
      )
      await deps.categoryDeletionRequestRepository.save(failed)
      throw e
    }
  })

  app.delete('/:id', c => {
    CategoryIdSchema.parse(c.req.param('id'))
    // 削除はリマップフロー経由のみ（08h §2）。誤って旧 API を叩いた場合に新フローを案内する
    throw new InvariantViolationError(
      '削除は削除リクエスト経由で行う: POST /api/categories/:id/deletion-requests',
    )
  })

  return app
}
