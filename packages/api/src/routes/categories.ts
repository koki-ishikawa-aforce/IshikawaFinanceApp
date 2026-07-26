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
import { newUlid } from '@warimaru/adapters-postgres'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'

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
      // リマップ要請を発火する。各コンテキストの付け替え → 完了通知 → コーディネーターによる
      // 物理削除まで同期バス上で連鎖して完了する（#223）。
      await deps.eventBus.publish(
        CategoryDeletionRemapRequestedSchema.parse({
          ...domainEventBase(now),
          type: 'CategoryDeletionRemapRequested',
          categoryDeletionRequestId: pending.categoryDeletionRequestId,
          targetCategoryId: target.categoryId,
          destinationCategoryId: body.destinationCategoryId,
          destinationExpenseClass: body.destinationExpenseClass,
        }),
      )
    } catch (e) {
      // コーディネーターが remap_completed まで到達済みなら、後続の副作用失敗で
      // 完了を remap_failed に覆さない（マスタ削除済みなのに失敗記録、を防ぐ）。
      const current = await deps.categoryDeletionRequestRepository.findById(
        pending.categoryDeletionRequestId,
      )
      if (current?.state.kind === 'remap_completed') {
        return c.json({ request: current }, 201)
      }
      const failed = failCategoryRemap(
        requested,
        e instanceof Error ? e.message : String(e),
        new Date(),
      )
      await deps.categoryDeletionRequestRepository.save(failed)
      throw e
    }

    const finalized = await deps.categoryDeletionRequestRepository.findById(
      pending.categoryDeletionRequestId,
    )
    if (finalized === null) {
      throw new NotFoundError('CategoryDeletionRequest', pending.categoryDeletionRequestId)
    }
    // 依頼先コンテキストの完了通知が全て揃えばコーディネーターが remap_completed へ遷移する。
    // 揃わない（購読漏れ等の想定外配線）まま 201 を返さず、内部エラーとして顕在化させる。
    if (finalized.state.kind !== 'remap_completed') {
      throw new Error('カテゴリ削除リマップが完了しなかった（完了通知が揃わなかった）')
    }
    return c.json({ request: finalized }, 201)
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
