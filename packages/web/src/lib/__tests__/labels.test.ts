import { describe, expect, it } from 'vitest'
import { learnedAxisLabels } from '../labels'
import type { LearningRefsWire } from '../api-schemas'

const categoryNameOf = (id: string) => (id === 'CAT_FOOD' ? '食費' : undefined)
const expenseTypeNameOf = (id: string) => (id === 'ET_TRANSPORT' ? '交通費' : undefined)

function refs(overrides: Partial<LearningRefsWire> = {}): LearningRefsWire {
  return {
    categoryRef: { kind: 'unlearned' },
    expenseClassRef: { kind: 'unlearned' },
    expenseTypeRef: { kind: 'unlearned' },
    ...overrides,
  }
}

describe('learnedAxisLabels', () => {
  it('学習済みの軸はマスタ名・費用区分名を表示する', () => {
    const labels = learnedAxisLabels(
      refs({
        categoryRef: { kind: 'learned', categoryId: 'CAT_FOOD' },
        expenseClassRef: { kind: 'learned', expenseClass: 'business_expense' },
        expenseTypeRef: { kind: 'learned', expenseTypeId: 'ET_TRANSPORT' },
      }),
      categoryNameOf,
      expenseTypeNameOf,
    )

    expect(labels).toEqual([
      { axis: 'category', value: '食費', learned: true },
      { axis: 'expense_class', value: '経費(会社)', learned: true },
      { axis: 'expense_type', value: '交通費', learned: true },
    ])
  })

  it('未学習の軸も落とさず、まだ覚えていないことを示す（3軸すべてを返す）', () => {
    const labels = learnedAxisLabels(refs(), categoryNameOf, expenseTypeNameOf)

    expect(labels.map(l => l.axis)).toEqual(['category', 'expense_class', 'expense_type'])
    expect(labels.every(l => !l.learned)).toBe(true)
    expect(labels.every(l => l.value === 'まだ覚えていません')).toBe(true)
  })

  it('軸ごとに独立して学習状態を表示する（T-2: 一部の軸だけ学習済み）', () => {
    const labels = learnedAxisLabels(
      refs({ expenseClassRef: { kind: 'learned', expenseClass: 'household' } }),
      categoryNameOf,
      expenseTypeNameOf,
    )

    expect(labels[0]).toEqual({ axis: 'category', value: 'まだ覚えていません', learned: false })
    expect(labels[1]).toEqual({ axis: 'expense_class', value: '世帯', learned: true })
    expect(labels[2]).toEqual({ axis: 'expense_type', value: 'まだ覚えていません', learned: false })
  })

  it('名前を引けないマスタ ID は未学習ではなく「（不明）」として学習済みのまま示す', () => {
    const labels = learnedAxisLabels(
      refs({
        categoryRef: { kind: 'learned', categoryId: 'CAT_DELETED' },
        expenseTypeRef: { kind: 'learned', expenseTypeId: 'ET_DELETED' },
      }),
      categoryNameOf,
      expenseTypeNameOf,
    )

    expect(labels[0]).toEqual({ axis: 'category', value: '（不明）', learned: true })
    expect(labels[2]).toEqual({ axis: 'expense_type', value: '（不明）', learned: true })
  })
})
