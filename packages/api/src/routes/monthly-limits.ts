import { Hono } from 'hono'
import { z } from 'zod'
import {
  ExpenseTypeIdSchema,
  MonthlyLimitIdSchema,
  MonthlyLimitSchema,
  NotFoundError,
  YearMonthSchema,
} from '@warimaru/domain'
import type {
  ExpenseTypeMasterRepository,
  MonthlyLimit,
  MonthlyLimitRepository,
  YearMonth,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'

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

export function monthlyLimitsRoutes(
  monthlyLimitRepository: MonthlyLimitRepository,
  expenseTypeMasterRepository: ExpenseTypeMasterRepository,
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
    const items =
      params.month === undefined
        ? limits
        : limits.filter(limit => limit.effectiveFrom <= endOfMonth(params.month as YearMonth))
    return c.json({ items })
  })

  app.put('/', async c => {
    const body = PutBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const now = new Date()

    const expenseType = await expenseTypeMasterRepository.findById(body.expenseTypeId)
    if (expenseType === null) throw new NotFoundError('ExpenseTypeMaster', body.expenseTypeId)

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
    await monthlyLimitRepository.save(limit)
    return c.json(limit)
  })

  return app
}
