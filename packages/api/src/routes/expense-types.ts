import { Hono } from 'hono'
import { z } from 'zod'
import {
  AmazonProductKeyLearningRuleSchema,
  ClassifiedDetailsSchema,
  ExpenseTypeDeletionRequestIdSchema,
  ExpenseTypeDeletionRequestSchema,
  ExpenseTypeIdSchema,
  ExpenseTypeMasterSchema,
  InvariantViolationError,
  MerchantLearningRuleSchema,
  NotFoundError,
  PermissionDeniedError,
  TransactionSchema,
  assertExpenseTypeNameAvailable,
  completeExpenseTypeRemap,
  failExpenseTypeRemap,
  renameCustomExpenseType,
  requestExpenseTypeRemap,
} from '@warimaru/domain'
import type {
  AmazonProductKeyLearningRuleRepository,
  CustomExpenseType,
  ExpenseTypeDeletionRequestRepository,
  ExpenseTypeMaster,
  ExpenseTypeMasterRepository,
  MerchantLearningRuleRepository,
  MonthlyLimitRepository,
  PendingRemapExpenseTypeDeletionRequest,
  TransactionRepository,
  UserId,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'

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
  transactionRepository: TransactionRepository
  merchantLearningRuleRepository: MerchantLearningRuleRepository
  amazonProductKeyLearningRuleRepository: AmazonProductKeyLearningRuleRepository
  monthlyLimitRepository: MonthlyLimitRepository
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
    if (destination.scope.kind === 'personal' && destination.scope.userId !== viewerId) {
      throw new PermissionDeniedError('他ユーザーの経費種別は移動先にできない')
    }

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
      // 経費精算: 経費(会社)取引の経費種別のみ移動先へ付け替える（費用区分・basis は保持）
      const transactions = await deps.transactionRepository.findClassifiedByExpenseType(
        target.expenseTypeId,
      )
      for (const transaction of transactions) {
        const details = ClassifiedDetailsSchema.parse({
          ...transaction.details,
          expenseTypeRef: { kind: 'business', expenseTypeId: body.destinationExpenseTypeId },
        })
        await deps.transactionRepository.save(TransactionSchema.parse({ ...transaction, details }))
      }

      // 自動分類・学習: 学習ルールは経費種別軸のみリマップする（T-2 軸独立）
      let affectedLearningRuleCount = 0
      const merchantRules = await deps.merchantLearningRuleRepository.findAllByUser(viewerId)
      for (const rule of merchantRules) {
        if (
          rule.kind !== 'active' ||
          rule.expenseTypeRef.kind !== 'learned' ||
          rule.expenseTypeRef.expenseTypeId !== target.expenseTypeId
        ) {
          continue
        }
        await deps.merchantLearningRuleRepository.save(
          MerchantLearningRuleSchema.parse({
            ...rule,
            expenseTypeRef: { kind: 'learned', expenseTypeId: body.destinationExpenseTypeId },
            lastUpdatedAt: now,
          }),
        )
        affectedLearningRuleCount++
      }
      const amazonRules = await deps.amazonProductKeyLearningRuleRepository.findAllByUser(viewerId)
      for (const rule of amazonRules) {
        if (
          rule.expenseTypeRef.kind !== 'learned' ||
          rule.expenseTypeRef.expenseTypeId !== target.expenseTypeId
        ) {
          continue
        }
        await deps.amazonProductKeyLearningRuleRepository.save(
          AmazonProductKeyLearningRuleSchema.parse({
            ...rule,
            expenseTypeRef: { kind: 'learned', expenseTypeId: body.destinationExpenseTypeId },
            lastUpdatedAt: now,
          }),
        )
        affectedLearningRuleCount++
      }

      // 削除対象経費種別の月次上限は残すと宙に浮くため物理削除する
      await deps.monthlyLimitRepository.deleteByExpenseType(target.expenseTypeId)

      const completed = completeExpenseTypeRemap(
        requested,
        { affectedTransactionCount: transactions.length, affectedLearningRuleCount },
        new Date(),
      )
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
