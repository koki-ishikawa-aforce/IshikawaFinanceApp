import { describe, it, expect } from 'vitest'
import { ExpenseTypeMasterSchema } from '../../../src/master-data/aggregates/ExpenseTypeMaster'

describe('ExpenseTypeMaster 集約', () => {
  it('規定経費種別 5 種（世帯共有）は parse 成功', () => {
    const kinds = ['gym', 'books_newspaper', 'ai_usage', 'transportation', 'other_expense']
    for (const defaultKind of kinds) {
      expect(() =>
        ExpenseTypeMasterSchema.parse({
          kind: 'default',
          expenseTypeId: `exp_${defaultKind}` as never,
          name: defaultKind,
          scope: { kind: 'household_shared' },
          defaultKind,
        }),
      ).not.toThrow()
    }
  })

  it('規定経費種別が個人別スコープなら parse 失敗', () => {
    expect(() =>
      ExpenseTypeMasterSchema.parse({
        kind: 'default',
        expenseTypeId: 'exp_gym' as never,
        name: 'ジム',
        scope: { kind: 'personal', userId: 'user_honey' as never },
        defaultKind: 'gym',
      }),
    ).toThrow()
  })

  it('追加経費種別（個人別）は parse 成功、世帯共有なら parse 失敗', () => {
    const custom = {
      kind: 'custom',
      expenseTypeId: 'exp_custom' as never,
      name: 'セミナー費',
      scope: { kind: 'personal', userId: 'user_honey' as never },
      createdAt: new Date(),
      createdByUserId: 'user_honey' as never,
      renameHistory: [],
    }
    expect(() => ExpenseTypeMasterSchema.parse(custom)).not.toThrow()
    expect(() =>
      ExpenseTypeMasterSchema.parse({ ...custom, scope: { kind: 'household_shared' } }),
    ).toThrow()
  })
})
