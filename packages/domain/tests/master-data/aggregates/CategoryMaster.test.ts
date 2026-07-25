import { describe, it, expect } from 'vitest'
import {
  CategoryMasterSchema,
  assertCategoryNameAvailable,
  seedDefaultCategory,
  DEFAULT_CATEGORY_NAMES,
  renameCustomCategory,
  type CustomCategory,
} from '../../../src/master-data/aggregates/CategoryMaster'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'

const defaultCategory = {
  kind: 'default',
  categoryId: '01CAT00000000000000000F00D' as never,
  name: '食費',
  scope: { kind: 'household_shared' },
  defaultKind: 'food',
}

const customCategory = {
  kind: 'custom',
  categoryId: '01CAT00000000000000000CSTM' as never,
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

describe('assertCategoryNameAvailable（同一スコープ内で名前一意、09-aggregates #18）', () => {
  const visible = [
    CategoryMasterSchema.parse(defaultCategory),
    CategoryMasterSchema.parse(customCategory),
  ]

  it('可視マスタと重複しない名前は通る', () => {
    expect(() => assertCategoryNameAvailable(visible, '推し活')).not.toThrow()
  })

  it('世帯共有（規定）と同名は InvariantViolationError', () => {
    expect(() => assertCategoryNameAvailable(visible, '食費')).toThrow(InvariantViolationError)
  })

  it('本人の個人別（追加）と同名は InvariantViolationError', () => {
    expect(() => assertCategoryNameAvailable(visible, 'ペット')).toThrow(InvariantViolationError)
  })

  it('改名時は自身を除外して検査する（現在名のままの改名は通る）', () => {
    const custom = CategoryMasterSchema.parse(customCategory) as CustomCategory
    expect(() => assertCategoryNameAvailable(visible, 'ペット', custom.categoryId)).not.toThrow()
    expect(() => assertCategoryNameAvailable(visible, '食費', custom.categoryId)).toThrow(
      InvariantViolationError,
    )
  })
})

describe('規定カテゴリの seed 投入 (#322)', () => {
  it('規定 4 種の名前が 08h のユビキタス言語と一致する', () => {
    expect(DEFAULT_CATEGORY_NAMES).toEqual({
      housing_utilities_communication: '住居光熱通信',
      food: '食費',
      entertainment: '娯楽',
      other: 'その他',
    })
  })

  it('seedDefaultCategory は世帯共有スコープの規定カテゴリを作る', () => {
    const category = seedDefaultCategory({
      categoryId: '01JAAAAAAAAAAAAAAAAAAAAAA2' as never,
      defaultKind: 'food',
    })

    expect(category).toEqual({
      kind: 'default',
      categoryId: '01JAAAAAAAAAAAAAAAAAAAAAA2',
      name: '食費',
      scope: { kind: 'household_shared' },
      defaultKind: 'food',
    })
  })
})
