import { Hono } from 'hono'
import { z } from 'zod'
import {
  ExpenseTypeIdSchema,
  MonthlyLimitChangedSchema,
  MonthlyLimitCreatedSchema,
  MonthlyLimitIdSchema,
  MonthlyLimitSchema,
  NotFoundError,
  PermissionDeniedError,
  YearMonthSchema,
} from '@warimaru/domain'
import type {
  EventBus,
  ExpenseTypeMasterRepository,
  MonthlyLimit,
  MonthlyLimitRepository,
  YearMonth,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'
import { readJsonObjectBody } from '../read-request-body.js'

const ListParamsSchema = z.object({
  month: YearMonthSchema.optional(),
})

const PutBodySchema = z.object({
  expenseTypeId: ExpenseTypeIdSchema,
  /** null = 無制限（上限なし） */
  capAmount: z.number().int().nonnegative().nullable(),
  changeReason: z.string().min(1).optional(),
})

/** 対象月の末尾時点（UTC）。effectiveFrom がこれ以前なら当月に適用されている */
function endOfMonth(month: YearMonth): Date {
  const [year, mo] = month.split('-').map(Number)
  return new Date(Date.UTC(year ?? 0, mo ?? 1, 1) - 1)
}

/**
 * 対象月の時点で適用されていた上限を changeHistory から復元する。
 * 月末より後の変更を最古のものまで巻き戻し、その oldCapAmount が当時の上限。
 * capped ↔ unlimited の切替は仕様上 unlimited が履歴を持たないため復元不可
 * （現在の値をそのまま返す）。適用開始前（effectiveFrom > 月末）は null。
 */
function reconstructForMonth(limit: MonthlyLimit, endOfTargetMonth: Date): MonthlyLimit | null {
  if (limit.effectiveFrom > endOfTargetMonth) return null
  if (limit.kind === 'unlimited') return limit
  const futureChanges = limit.changeHistory
    .filter(change => change.changedAt > endOfTargetMonth)
    .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
  const oldest = futureChanges[0]
  if (oldest === undefined) return limit
  return MonthlyLimitSchema.parse({
    ...limit,
    capAmount: oldest.oldCapAmount,
    // 当時見えていた履歴のみ残す
    changeHistory: limit.changeHistory.filter(change => change.changedAt <= endOfTargetMonth),
  })
}

export function monthlyLimitsRoutes(
  monthlyLimitRepository: MonthlyLimitRepository,
  expenseTypeMasterRepository: ExpenseTypeMasterRepository,
  eventBus: EventBus,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const params = ListParamsSchema.parse({ month: c.req.query('month') })
    const viewerId = c.get('viewerId')
    const expenseTypes = await expenseTypeMasterRepository.findAllVisibleToUser(viewerId)
    const limits = (
      await Promise.all(
        expenseTypes.map(expenseType =>
          monthlyLimitRepository.findByUserAndExpenseType(viewerId, expenseType.expenseTypeId),
        ),
      )
    ).filter((limit): limit is MonthlyLimit => limit !== null)
    const month = params.month
    const items =
      month === undefined
        ? limits
        : limits
            .map(limit => reconstructForMonth(limit, endOfMonth(month)))
            .filter((limit): limit is MonthlyLimit => limit !== null)
    return c.json({ items })
  })

  app.put('/', async c => {
    const body = PutBodySchema.parse(readJsonObjectBody(await c.req.text()))
    const viewerId = c.get('viewerId')
    const now = new Date()

    const expenseType = await expenseTypeMasterRepository.findById(body.expenseTypeId)
    if (expenseType === null) throw new NotFoundError('ExpenseTypeMaster', body.expenseTypeId)
    if (expenseType.scope.kind === 'personal' && expenseType.scope.userId !== viewerId) {
      throw new PermissionDeniedError('他ユーザーの個人別経費種別には上限を設定できない')
    }

    const existing = await monthlyLimitRepository.findByUserAndExpenseType(
      viewerId,
      body.expenseTypeId,
    )
    const monthlyLimitId = existing?.monthlyLimitId ?? MonthlyLimitIdSchema.parse(newUlid())

    const limit = MonthlyLimitSchema.parse(
      body.capAmount === null
        ? {
            kind: 'unlimited',
            monthlyLimitId,
            userId: viewerId,
            expenseTypeId: body.expenseTypeId,
            effectiveFrom: now,
          }
        : {
            kind: 'capped',
            monthlyLimitId,
            userId: viewerId,
            expenseTypeId: body.expenseTypeId,
            effectiveFrom: existing?.effectiveFrom ?? now,
            capAmount: body.capAmount,
            changeHistory:
              existing?.kind === 'capped'
                ? [
                    ...existing.changeHistory,
                    {
                      oldCapAmount: existing.capAmount,
                      newCapAmount: body.capAmount,
                      changedAt: now,
                      changedByUserId: viewerId,
                      ...(body.changeReason !== undefined
                        ? { changeReason: body.changeReason }
                        : {}),
                    },
                  ]
                : [],
          },
    )
    const domainEvent = (() => {
      if (existing !== null) {
        const oldSeedLimit =
          existing.kind === 'capped'
            ? { kind: 'capped' as const, capAmount: existing.capAmount }
            : { kind: 'unlimited' as const }
        const newSeedLimit =
          limit.kind === 'capped'
            ? { kind: 'capped' as const, capAmount: limit.capAmount }
            : { kind: 'unlimited' as const }
        if (
          oldSeedLimit.kind === newSeedLimit.kind &&
          oldSeedLimit.capAmount === newSeedLimit.capAmount
        ) {
          return null
        }
        return MonthlyLimitChangedSchema.parse({
          ...domainEventBase(now),
          type: 'MonthlyLimitChanged',
          monthlyLimitId,
          oldLimit: oldSeedLimit,
          newLimit: newSeedLimit,
          changedByUserId: viewerId,
        })
      }
      return MonthlyLimitCreatedSchema.parse({
        ...domainEventBase(now),
        type: 'MonthlyLimitCreated',
        monthlyLimitId,
        userId: viewerId,
        expenseTypeId: body.expenseTypeId,
        seedLimit:
          limit.kind === 'capped'
            ? { kind: 'capped' as const, capAmount: limit.capAmount }
            : { kind: 'unlimited' as const },
      })
    })()

    await monthlyLimitRepository.save(limit)
    if (domainEvent !== null) {
      await eventBus.publish(domainEvent)
    }

    return c.json(limit)
  })

  return app
}
