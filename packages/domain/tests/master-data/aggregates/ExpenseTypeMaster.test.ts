import { describe, it, expect } from 'vitest'
import {
  ExpenseTypeMasterSchema,
  assertExpenseTypeNameAvailable,
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
