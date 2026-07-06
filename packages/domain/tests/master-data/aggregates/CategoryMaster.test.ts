import { describe, it, expect } from 'vitest'
import {
  CategoryMasterSchema,
  renameCustomCategory,
  type CustomCategory,
} from '../../../src/master-data/aggregates/CategoryMaster'

const defaultCategory = {
  kind: 'default',
  categoryId: 'cat_food' as never,
  name: '食費',
  scope: { kind: 'household_shared' },
  defaultKind: 'food',
}

const customCategory = {
  kind: 'custom',
  categoryId: 'cat_custom' as never,
  name: 'ペット',
  scope: { kind: 'personal', userId: 'user_honey' as never },
  createdAt: new Date(),
  createdByUserId: 'user_honey' as never,
  renameHistory: [],
}

describe('CategoryMaster 集約', () => {
  it('規定カテゴリ（世帯共有）は parse 成功', () => {
    expect(() => CategoryMasterSchema.parse(defaultCategory)).not.toThrow()
  })

  it('規定カテゴリが個人別スコープなら parse 失敗', () => {
    expect(() =>
      CategoryMasterSchema.parse({
        ...defaultCategory,
        scope: { kind: 'personal', userId: 'user_honey' as never },
      }),
    ).toThrow()
  })

  it('追加カテゴリ（個人別）は parse 成功', () => {
    expect(() => CategoryMasterSchema.parse(customCategory)).not.toThrow()
  })

  it('追加カテゴリが世帯共有スコープなら parse 失敗', () => {
    expect(() =>
      CategoryMasterSchema.parse({ ...customCategory, scope: { kind: 'household_shared' } }),
    ).toThrow()
  })

  it('renameCustomCategory: 追加カテゴリの改名は改名履歴に積まれる（規定カテゴリの改名関数は存在しない）', () => {
    const custom = CategoryMasterSchema.parse(customCategory) as CustomCategory
    const renamed = renameCustomCategory(custom, 'ペット費', custom.createdByUserId, new Date())
    expect(renamed.name).toBe('ペット費')
    expect(renamed.renameHistory).toHaveLength(1)
    expect(renamed.renameHistory[0]?.oldName).toBe('ペット')
  })
})
