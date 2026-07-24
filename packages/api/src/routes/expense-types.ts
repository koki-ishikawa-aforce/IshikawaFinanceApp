import { Hono } from 'hono'
import { z } from 'zod'
import {
  ExpenseTypeDeletionRemapRequestedSchema,
  ExpenseTypeDeletionRequestIdSchema,
  ExpenseTypeDeletionRequestSchema,
  ExpenseTypeIdSchema,
  ExpenseTypeMasterSchema,
  InvariantViolationError,
  NotFoundError,
  PermissionDeniedError,
  assertExpenseTypeNameAvailable,
  assertVisibleTo,
  completeExpenseTypeRemap,
  failExpenseTypeRemap,
  renameCustomExpenseType,
  requestExpenseTypeRemap,
} from '@warimaru/domain'
import type {
  CustomExpenseType,
  EventBus,
  ExpenseTypeDeletionRequestRepository,
  ExpenseTypeMaster,
  ExpenseTypeMasterRepository,
  MonthlyLimitRepository,
  PendingRemapExpenseTypeDeletionRequest,
  UserId,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'
import type { RemapResults } from '../event-handlers/master-data-remap.js'

const BodySchema = z.object({ name: z.string().min(1) })

const DeletionRequestBodySchema = z.object({
  destinationExpenseTypeId: ExpenseTypeIdSchema,
})

/** 規定経費種別は改名・削除不可、追加経費種別は作成者本人のみ操作可 */
function assertEditableCustomExpenseType(
  expenseType: ExpenseTypeMaster,
  viewerId: UserId,
): asserts expenseType is CustomExpenseType {
  if (expenseType.kind !== 'custom') {
    throw new InvariantViolationError('規定経費種別は改名・削除できない')
  }
  if (expenseType.scope.kind !== 'personal' || expenseType.scope.userId !== viewerId) {
    throw new PermissionDeniedError('他ユーザーの経費種別は操作できない')
  }
}

export interface ExpenseTypesRoutesDeps {
  expenseTypeMasterRepository: ExpenseTypeMasterRepository
  expenseTypeDeletionRequestRepository: ExpenseTypeDeletionRequestRepository
  monthlyLimitRepository: MonthlyLimitRepository
  eventBus: EventBus
}

export function expenseTypesRoutes(deps: ExpenseTypesRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const viewerId = c.get('viewerId')
    const items = await deps.expenseTypeMasterRepository.findAllVisibleToUser(viewerId)
    return c.json({ items })
  })

  app.post('/', async c => {
    const body = BodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    assertExpenseTypeNameAvailable(
      await deps.expenseTypeMasterRepository.findAllVisibleToUser(viewerId),
      body.name,
    )
    const expenseType = ExpenseTypeMasterSchema.parse({
      kind: 'custom',
      expenseTypeId: ExpenseTypeIdSchema.parse(newUlid()),
      name: body.name,
      scope: { kind: 'personal', userId: viewerId },
      createdAt: new Date(),
      createdByUserId: viewerId,
      renameHistory: [],
    })
    await deps.expenseTypeMasterRepository.save(expenseType)
    return c.json(expenseType, 201)
  })

  app.put('/:id', async c => {
    const id = ExpenseTypeIdSchema.parse(c.req.param('id'))
    const body = BodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const expenseType = await deps.expenseTypeMasterRepository.findById(id)
    if (expenseType === null) throw new NotFoundError('ExpenseTypeMaster', id)
    assertEditableCustomExpenseType(expenseType, viewerId)
    assertExpenseTypeNameAvailable(
      await deps.expenseTypeMasterRepository.findAllVisibleToUser(viewerId),
      body.name,
      expenseType.expenseTypeId,
    )
    const renamed = renameCustomExpenseType(expenseType, body.name, viewerId, new Date())
    await deps.expenseTypeMasterRepository.save(renamed)
    return c.json(renamed)
  })

  /**
   * 追加経費種別の削除リクエスト（08h §2: 受付 → リマップ依頼 → リマップ実行 → 完了 → 物理削除）。
   * 取引は経費(会社)のまま経費種別のみ移動する。月次上限は削除対象の分を物理削除する。
   * 確定済み経費精算サイクルの集積スナップショットは歴史的記録として意図的に保持する。
   */
  app.post('/:id/deletion-requests', async c => {
    const id = ExpenseTypeIdSchema.parse(c.req.param('id'))
    const body = DeletionRequestBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')

    const target = await deps.expenseTypeMasterRepository.findById(id)
    if (target === null) throw new NotFoundError('ExpenseTypeMaster', id)
    assertEditableCustomExpenseType(target, viewerId)

    if (body.destinationExpenseTypeId === target.expenseTypeId) {
      throw new InvariantViolationError('移動先経費種別に削除対象自身は指定できない')
    }
    const destination = await deps.expenseTypeMasterRepository.findById(
      body.destinationExpenseTypeId,
    )
    if (destination === null) {
      throw new NotFoundError('ExpenseTypeMaster', body.destinationExpenseTypeId)
    }
    assertVisibleTo(destination.scope, viewerId, '経費種別')

    const now = new Date()
    const pending = ExpenseTypeDeletionRequestSchema.parse({
      expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestIdSchema.parse(newUlid()),
      targetExpenseTypeId: target.expenseTypeId,
      requestedByUserId: viewerId,
      destinationExpenseTypeId: body.destinationExpenseTypeId,
      requestedAt: now,
      state: { kind: 'pending_remap' },
    }) as PendingRemapExpenseTypeDeletionRequest
    await deps.expenseTypeDeletionRequestRepository.save(pending)

    const requested = requestExpenseTypeRemap(
      pending,
      ['expense_settlement', 'auto_classification'],
      now,
    )
    await deps.expenseTypeDeletionRequestRepository.save(requested)

    try {
      const remapResults: RemapResults = {
        affectedTransactionCount: 0,
        affectedLearningRuleCount: 0,
      }
      const event = {
        ...ExpenseTypeDeletionRemapRequestedSchema.parse({
          ...domainEventBase(now),
          type: 'ExpenseTypeDeletionRemapRequested' as const,
          expenseTypeDeletionRequestId: pending.expenseTypeDeletionRequestId,
          targetExpenseTypeId: target.expenseTypeId,
          destinationExpenseTypeId: body.destinationExpenseTypeId,
        }),
        _remapResults: remapResults,
      }
      await deps.eventBus.publish(event)

      // 削除対象経費種別の月次上限は残すと宙に浮くため物理削除する
      await deps.monthlyLimitRepository.deleteByExpenseType(target.expenseTypeId)

      const completed = completeExpenseTypeRemap(requested, remapResults, new Date())
      await deps.expenseTypeDeletionRequestRepository.save(completed)
      await deps.expenseTypeMasterRepository.deleteById(target.expenseTypeId)
      return c.json({ request: completed }, 201)
    } catch (e) {
      const failed = failExpenseTypeRemap(
        requested,
        e instanceof Error ? e.message : String(e),
        new Date(),
      )
      await deps.expenseTypeDeletionRequestRepository.save(failed)
      throw e
    }
  })

  app.delete('/:id', c => {
    ExpenseTypeIdSchema.parse(c.req.param('id'))
    // 削除はリマップフロー経由のみ（08h §2）。誤って旧 API を叩いた場合に新フローを案内する
    throw new InvariantViolationError(
      '削除は削除リクエスト経由で行う: POST /api/expense-types/:id/deletion-requests',
    )
  })

  return app
}
