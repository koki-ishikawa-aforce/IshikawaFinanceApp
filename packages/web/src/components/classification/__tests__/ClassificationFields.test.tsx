import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  ClassificationFields,
  classificationBody,
  classificationValid,
  type ClassificationInput,
} from '../ClassificationFields'
import type { MastersState } from '../useMasters'

const loadedMasters: MastersState = {
  categories: [{ categoryId: 'CAT_FOOD', name: '食費' }],
  expenseTypes: [{ expenseTypeId: 'ET_GYM', name: 'ジム' }],
  isPending: false,
  isError: false,
  refetch: () => {},
}

function Harness({
  initial,
  masters = loadedMasters,
}: {
  initial: ClassificationInput
  masters?: MastersState
}) {
  const [value, setValue] = useState(initial)
  return <ClassificationFields value={value} onChange={setValue} masters={masters} />
}

describe('ClassificationFields', () => {
  it('ラベルと入力が関連付いている', () => {
    render(<Harness initial={{ categoryId: '', expenseClass: 'household' }} />)

    expect(screen.getByLabelText('カテゴリ')).toBeInTheDocument()
    expect(screen.getByLabelText('費用区分')).toBeInTheDocument()
  })

  it('経費(会社) を選んだときだけ経費種別を出す', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ categoryId: 'CAT_FOOD', expenseClass: 'household' }} />)

    expect(screen.queryByLabelText('経費種別')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('費用区分'), 'business_expense')

    expect(screen.getByLabelText('経費種別')).toBeInTheDocument()
  })

  it('マスタ取得中は空のセレクトを見せない', () => {
    render(
      <Harness
        initial={{ categoryId: '', expenseClass: 'household' }}
        masters={{ ...loadedMasters, categories: [], expenseTypes: [], isPending: true }}
      />,
    )

    expect(screen.queryByLabelText('カテゴリ')).not.toBeInTheDocument()
    expect(screen.getByText('分類の選択肢を読み込み中...')).toBeInTheDocument()
  })

  it('マスタ取得に失敗したら再試行手段を出す', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    render(
      <Harness
        initial={{ categoryId: '', expenseClass: 'household' }}
        masters={{ ...loadedMasters, categories: [], expenseTypes: [], isError: true, refetch }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('カテゴリ・経費種別を読み込めませんでした')
    expect(screen.queryByLabelText('カテゴリ')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '選択肢を再読み込み' }))

    expect(refetch).toHaveBeenCalled()
  })

  it('同じ画面に 2 つ並べても label と input の対応が崩れない', () => {
    render(
      <>
        <Harness initial={{ categoryId: '', expenseClass: 'household' }} />
        <Harness initial={{ categoryId: '', expenseClass: 'household' }} />
      </>,
    )

    const [first, second] = screen.getAllByLabelText('カテゴリ')
    expect(first?.id).not.toBe(second?.id)
  })
})

describe('classificationValid', () => {
  it('カテゴリ未選択は不成立', () => {
    expect(classificationValid({ categoryId: '', expenseClass: 'household' })).toBe(false)
  })

  it('経費(会社) は経費種別が無ければ不成立', () => {
    expect(classificationValid({ categoryId: 'CAT_FOOD', expenseClass: 'business_expense' })).toBe(
      false,
    )
    expect(
      classificationValid({
        categoryId: 'CAT_FOOD',
        expenseClass: 'business_expense',
        expenseTypeId: 'ET_GYM',
      }),
    ).toBe(true)
  })

  it('経費(会社) 以外はカテゴリだけで成立する', () => {
    expect(classificationValid({ categoryId: 'CAT_FOOD', expenseClass: 'household' })).toBe(true)
  })
})

describe('classificationBody', () => {
  it('経費(会社) 以外では経費種別を送らない', () => {
    expect(
      classificationBody({
        categoryId: 'CAT_FOOD',
        expenseClass: 'household',
        expenseTypeId: 'ET_GYM',
      }),
    ).toEqual({ categoryId: 'CAT_FOOD', expenseClass: 'household' })
  })

  it('経費(会社) では経費種別を送る', () => {
    expect(
      classificationBody({
        categoryId: 'CAT_FOOD',
        expenseClass: 'business_expense',
        expenseTypeId: 'ET_GYM',
      }),
    ).toEqual({
      categoryId: 'CAT_FOOD',
      expenseClass: 'business_expense',
      expenseTypeId: 'ET_GYM',
    })
  })
})
