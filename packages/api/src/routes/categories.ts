import { Hono } from 'hono'
import { z } from 'zod'
import {
  CategoryIdSchema,
  CategoryMasterSchema,
  InvariantViolationError,
  NotFoundError,
  PermissionDeniedError,
  renameCustomCategory,
} from '@warimaru/domain'
import type {
  CategoryMaster,
  CategoryMasterRepository,
  CustomCategory,
  UserId,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'

const BodySchema = z.object({ name: z.string().min(1) })

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

export function categoriesRoutes(categoryMasterRepository: CategoryMasterRepository): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  app.get('/', async c => {
    const viewerId = c.get('viewerId')
    const items = await categoryMasterRepository.findAllVisibleToUser(viewerId)
    return c.json({ items })
  })

  app.post('/', async c => {
    const body = BodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const category = CategoryMasterSchema.parse({
      kind: 'custom',
      categoryId: CategoryIdSchema.parse(newUlid()),
      name: body.name,
      scope: { kind: 'personal', userId: viewerId },
      createdAt: new Date(),
      createdByUserId: viewerId,
      renameHistory: [],
    })
    await categoryMasterRepository.save(category)
    return c.json(category, 201)
  })

  app.put('/:id', async c => {
    const id = CategoryIdSchema.parse(c.req.param('id'))
    const body = BodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const category = await categoryMasterRepository.findById(id)
    if (category === null) throw new NotFoundError('CategoryMaster', id)
    assertEditableCustomCategory(category, viewerId)
    const renamed = renameCustomCategory(category, body.name, viewerId, new Date())
    await categoryMasterRepository.save(renamed)
    return c.json(renamed)
  })

  app.delete('/:id', async c => {
    const id = CategoryIdSchema.parse(c.req.param('id'))
    const viewerId = c.get('viewerId')
    const category = await categoryMasterRepository.findById(id)
    if (category === null) throw new NotFoundError('CategoryMaster', id)
    assertEditableCustomCategory(category, viewerId)
    await categoryMasterRepository.deleteById(id)
    return c.body(null, 204)
  })

  return app
}
