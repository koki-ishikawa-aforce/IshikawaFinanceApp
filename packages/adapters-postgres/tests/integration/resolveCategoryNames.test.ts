import { describe, it, expect } from 'vitest'
import type { CategoryId } from '@warimaru/domain'
import { db } from './setup'
import { NeonCategoryMasterRepository } from '../../src/master-data/NeonCategoryMasterRepository'
import { createDbResolveCategoryNames } from '../../src/master-data/resolveCategoryNames'
import { customCategory, defaultCategory } from '../helpers/masterDataFixtures'

describe('createDbResolveCategoryNames（第1波 queryDeps スタブの実 DB 差し替え）', () => {
  const repo = new NeonCategoryMasterRepository(db)
  const resolve = createDbResolveCategoryNames(db)

  it('登録済み ID を名前に解決し、未知 ID は Map に含めない', async () => {
    const food = defaultCategory({ name: '食費' })
    const hobby = customCategory({ name: '推し活' })
    await repo.save(food)
    await repo.save(hobby)

    const unknown = '01HZZZZZZZZZZZZZZZZZZZZZZZ' as CategoryId
    const names = await resolve([food.categoryId, hobby.categoryId, unknown])
    expect(names.get(food.categoryId)).toBe('食費')
    expect(names.get(hobby.categoryId)).toBe('推し活')
    expect(names.has(unknown)).toBe(false)
  })

  it('空配列は空 Map（SQL を発行しない経路）', async () => {
    expect((await resolve([])).size).toBe(0)
  })
})
