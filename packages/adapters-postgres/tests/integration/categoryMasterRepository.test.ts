import { describe, it, expect } from 'vitest'
import type { CategoryId, CustomCategory } from '@warimaru/domain'
import { InvariantViolationError, renameCustomCategory } from '@warimaru/domain'
import { db } from './setup'
import { PostgresCategoryMasterRepository } from '../../src/master-data/PostgresCategoryMasterRepository'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import { customCategory, defaultCategory } from '../helpers/masterDataFixtures'

const repo = new PostgresCategoryMasterRepository(db)

describe('PostgresCategoryMasterRepository', () => {
  it('save → findById の往復同一性（default / custom 両変種）', async () => {
    const def = defaultCategory()
    const custom = customCategory()
    await repo.save(def)
    await repo.save(custom)
    expect(await repo.findById(def.categoryId)).toEqual(def)
    expect(await repo.findById(custom.categoryId)).toEqual(custom)
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as CategoryId)).toBeNull()
  })

  it('改名の再 save で上書きされる（renameHistory も payload に載る）', async () => {
    const custom = customCategory({ name: '推し活' }) as CustomCategory
    await repo.save(custom)
    const renamed = renameCustomCategory(
      custom,
      'ライブ遠征',
      HONEY_USER_ID,
      new Date('2026-07-02T00:00:00.000Z'),
    )
    await repo.save(renamed)
    const found = await repo.findById(custom.categoryId)
    expect(found).toEqual(renamed)
  })

  it('findAllVisibleToUser は世帯共有 + 本人の個人別のみ返す（配偶者の個人別は遮断）', async () => {
    const shared = defaultCategory({ name: '食費' })
    const mine = customCategory({ name: '推し活', userId: HONEY_USER_ID })
    const spouses = customCategory({ name: 'ゴルフ', userId: DARLING_USER_ID })
    await repo.save(shared)
    await repo.save(mine)
    await repo.save(spouses)

    const visible = await repo.findAllVisibleToUser(HONEY_USER_ID)
    const ids = visible.map(c => c.categoryId)
    expect(ids).toContain(shared.categoryId)
    expect(ids).toContain(mine.categoryId)
    expect(ids).not.toContain(spouses.categoryId)
  })

  it('同一スコープ（個人別）の名前重複は InvariantViolationError', async () => {
    await repo.save(customCategory({ name: '推し活', userId: HONEY_USER_ID }))
    await expect(
      repo.save(customCategory({ name: '推し活', userId: HONEY_USER_ID })),
    ).rejects.toThrow(InvariantViolationError)
  })

  it('世帯共有（owner NULL）同士の名前重複も拒否する（NULLS NOT DISTINCT）', async () => {
    await repo.save(defaultCategory({ name: '食費' }))
    await expect(repo.save(defaultCategory({ name: '食費' }))).rejects.toThrow(
      InvariantViolationError,
    )
  })

  it('スコープが異なれば同名を許す（世帯共有 vs 個人別、別ユーザー同士）', async () => {
    await repo.save(defaultCategory({ name: '食費' }))
    await expect(
      repo.save(customCategory({ name: '食費', userId: HONEY_USER_ID })),
    ).resolves.toBeUndefined()
    await expect(
      repo.save(customCategory({ name: '食費', userId: DARLING_USER_ID })),
    ).resolves.toBeUndefined()
  })
})
