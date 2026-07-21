import { Hono } from 'hono'
import { z } from 'zod'
import {
  ExpenseTypeIdSchema,
  ExpenseTypeMasterSchema,
  InvariantViolationError,
  NotFoundError,
  PermissionDeniedError,
  renameCustomExpenseType,
} from '@warimaru/domain'
import type {
  CustomExpenseType,
  ExpenseTypeMaster,
  ExpenseTypeMasterRepository,
  UserId,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'

const BodySchema = z.object({ name: z.string().min(1) })

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

export function expenseTypesRoutes(
  expenseTypeMasterRepository: ExpenseTypeMasterRepository,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const viewerId = c.get('viewerId')
    const items = await expenseTypeMasterRepository.findAllVisibleToUser(viewerId)
    return c.json({ items })
  })

  app.post('/', async c => {
    const body = BodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const expenseType = ExpenseTypeMasterSchema.parse({
      kind: 'custom',
      expenseTypeId: ExpenseTypeIdSchema.parse(newUlid()),
      name: body.name,
      scope: { kind: 'personal', userId: viewerId },
      createdAt: new Date(),
      createdByUserId: viewerId,
      renameHistory: [],
    })
    await expenseTypeMasterRepository.save(expenseType)
    return c.json(expenseType, 201)
  })

  app.put('/:id', async c => {
    const id = ExpenseTypeIdSchema.parse(c.req.param('id'))
    const body = BodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const expenseType = await expenseTypeMasterRepository.findById(id)
    if (expenseType === null) throw new NotFoundError('ExpenseTypeMaster', id)
    assertEditableCustomExpenseType(expenseType, viewerId)
    const renamed = renameCustomExpenseType(expenseType, body.name, viewerId, new Date())
    await expenseTypeMasterRepository.save(renamed)
    return c.json(renamed)
  })

  app.delete('/:id', async c => {
    const id = ExpenseTypeIdSchema.parse(c.req.param('id'))
    const viewerId = c.get('viewerId')
    const expenseType = await expenseTypeMasterRepository.findById(id)
    if (expenseType === null) throw new NotFoundError('ExpenseTypeMaster', id)
    assertEditableCustomExpenseType(expenseType, viewerId)
    await expenseTypeMasterRepository.deleteById(id)
    return c.body(null, 204)
  })

  return app
}
