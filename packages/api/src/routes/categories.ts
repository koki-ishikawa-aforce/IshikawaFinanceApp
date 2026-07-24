import { Hono } from 'hono'
import { z } from 'zod'
import {
  CategoryDeletionRemapRequestedSchema,
  CategoryDeletionRequestIdSchema,
  CategoryDeletionRequestSchema,
  CategoryIdSchema,
  CategoryMasterSchema,
  ExpenseClassSchema,
  ExpenseTypeIdSchema,
  InvariantViolationError,
  NotFoundError,
  PermissionDeniedError,
  assertCategoryNameAvailable,
  assertVisibleTo,
  completeCategoryRemap,
  failCategoryRemap,
  renameCustomCategory,
  requestCategoryRemap,
} from '@warimaru/domain'
import type {
  CategoryDeletionRequestRepository,
  CategoryMaster,
  CategoryMasterRepository,
  CustomCategory,
  EventBus,
  ExpenseTypeMasterRepository,
  PendingRemapCategoryDeletionRequest,
  UserId,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'
import type { RemapResults } from '../event-handlers/master-data-remap.js'

const BodySchema = z.object({ name: z.string().min(1) })

// 移動先費用区分と経費種別ID の整合(経費(会社)なら経費種別ID 必須/それ以外は指定不可)は
// ドメイン値オブジェクト CategoryDeletionRequestSchema の不変条件として強制されるため、
// ここでは素の形状のみを検証し、ルール強制は下段のドメイン parse に委ねる
// (CLAUDE.md: ドメイン不変条件を adapters/api 層で再実装しない)。
const DeletionRequestBodySchema = z.object({
  destinationCategoryId: CategoryIdSchema,
  destinationExpenseClass: ExpenseClassSchema,
  destinationExpenseTypeId: ExpenseTypeIdSchema.optional(),
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

export interface CategoriesRoutesDeps {
  categoryMasterRepository: CategoryMasterRepository
  expenseTypeMasterRepository: ExpenseTypeMasterRepository
  categoryDeletionRequestRepository: CategoryDeletionRequestRepository
  eventBus: EventBus
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
   * リマップはイベント駆動で実行し、途中失敗時は remap_failed を記録して中断する（マスタは残る）。
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
    assertVisibleTo(destination.scope, viewerId, 'カテゴリ')

    if (body.destinationExpenseTypeId !== undefined) {
      const destinationExpenseType = await deps.expenseTypeMasterRepository.findById(
        body.destinationExpenseTypeId,
      )
      if (destinationExpenseType === null) {
        throw new NotFoundError('ExpenseTypeMaster', body.destinationExpenseTypeId)
      }
      assertVisibleTo(destinationExpenseType.scope, viewerId, '経費種別')
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
      const remapResults: RemapResults = {
        affectedTransactionCount: 0,
        affectedLearningRuleCount: 0,
      }
      const event = {
        ...CategoryDeletionRemapRequestedSchema.parse({
          ...domainEventBase(now),
          type: 'CategoryDeletionRemapRequested' as const,
          categoryDeletionRequestId: pending.categoryDeletionRequestId,
          targetCategoryId: target.categoryId,
          destinationCategoryId: body.destinationCategoryId,
          destinationExpenseClass: body.destinationExpenseClass,
        }),
        _remapResults: remapResults,
      }
      await deps.eventBus.publish(event)

      const completed = completeCategoryRemap(requested, remapResults, new Date())
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
