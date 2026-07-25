import { describe, it, expect } from 'vitest'
import {
  ExpenseTypeMasterSchema,
  assertExpenseTypeNameAvailable,
  seedDefaultExpenseType,
  DEFAULT_EXPENSE_TYPE_NAMES,
} from '../../../src/master-data/aggregates/ExpenseTypeMaster'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'
import { testUlid } from '../../helpers/ids'

describe('ExpenseTypeMaster 集約', () => {
  it('規定経費種別 5 種（世帯共有）は parse 成功', () => {
    const kinds = ['gym', 'books_newspaper', 'ai_usage', 'transportation', 'other_expense']
    for (const [i, defaultKind] of kinds.entries()) {
      expect(() =>
        ExpenseTypeMasterSchema.parse({
          kind: 'default',
          expenseTypeId: testUlid('01EXP', i) as never,
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
        expenseTypeId: '01EXP000000000000000000GYM' as never,
        name: 'ジム',
        scope: { kind: 'personal', userId: 'user_honey' as never },
        defaultKind: 'gym',
      }),
    ).toThrow()
  })

  it('追加経費種別（個人別）は parse 成功、世帯共有なら parse 失敗', () => {
    const custom = {
      kind: 'custom',
      expenseTypeId: '01EXP00000000000000000CSTM' as never,
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

describe('assertExpenseTypeNameAvailable（同一スコープ内で名前一意、09-aggregates #19）', () => {
  const shared = ExpenseTypeMasterSchema.parse({
    kind: 'default',
    expenseTypeId: '01EXP000000000000000000GYM' as never,
    name: 'ジム',
    scope: { kind: 'household_shared' },
    defaultKind: 'gym',
  })
  const custom = ExpenseTypeMasterSchema.parse({
    kind: 'custom',
    expenseTypeId: '01EXP00000000000000000CSTM' as never,
    name: 'セミナー費',
    scope: { kind: 'personal', userId: 'user_honey' as never },
    createdAt: new Date(),
    createdByUserId: 'user_honey' as never,
    renameHistory: [],
  })
  const visible = [shared, custom]

  it('可視マスタと重複しない名前は通る', () => {
    expect(() => assertExpenseTypeNameAvailable(visible, '書籍費')).not.toThrow()
  })

  it('世帯共有（規定）・本人の個人別（追加）と同名は InvariantViolationError', () => {
    expect(() => assertExpenseTypeNameAvailable(visible, 'ジム')).toThrow(InvariantViolationError)
    expect(() => assertExpenseTypeNameAvailable(visible, 'セミナー費')).toThrow(
      InvariantViolationError,
    )
  })

  it('改名時は自身を除外して検査する（現在名のままの改名は通る）', () => {
    expect(() =>
      assertExpenseTypeNameAvailable(visible, 'セミナー費', custom.expenseTypeId),
    ).not.toThrow()
    expect(() => assertExpenseTypeNameAvailable(visible, 'ジム', custom.expenseTypeId)).toThrow(
      InvariantViolationError,
    )
  })
})

describe('規定経費種別の seed 投入 (#322)', () => {
  it('規定 5 種の名前が 08h のユビキタス言語と一致する', () => {
    expect(DEFAULT_EXPENSE_TYPE_NAMES).toEqual({
      gym: 'ジム',
      books_newspaper: '新聞図書費',
      ai_usage: 'AI利用費',
      transportation: '交通費',
      other_expense: 'その他経費',
    })
  })

  it('seedDefaultExpenseType は世帯共有スコープの規定経費種別を作る', () => {
    const expenseType = seedDefaultExpenseType({
      expenseTypeId: '01JEEEEEEEEEEEEEEEEEEEEEE1' as never,
      defaultKind: 'gym',
    })

    expect(expenseType).toEqual({
      kind: 'default',
      expenseTypeId: '01JEEEEEEEEEEEEEEEEEEEEEE1',
      name: 'ジム',
      scope: { kind: 'household_shared' },
      defaultKind: 'gym',
    })
  })

  it('名前は呼び出し側から差し替えられない（改名不可の規定名が唯一の出典）', () => {
    for (const defaultKind of [
      'gym',
      'books_newspaper',
      'ai_usage',
      'transportation',
      'other_expense',
    ] as const) {
      const expenseType = seedDefaultExpenseType({
        expenseTypeId: '01JEEEEEEEEEEEEEEEEEEEEEE1' as never,
        defaultKind,
      })
      expect(expenseType.name).toBe(DEFAULT_EXPENSE_TYPE_NAMES[defaultKind])
    }
  })
})
