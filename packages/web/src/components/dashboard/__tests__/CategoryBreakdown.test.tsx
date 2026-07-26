import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategoryBreakdownViewSchema } from '@warimaru/domain'
import { FALLBACK_CATEGORY_COLORS } from '@/theme/tokens'
import { CategoryBreakdown } from '../CategoryBreakdown'

const data = CategoryBreakdownViewSchema.parse({
  mode: 'household',
  yearMonth: '2026-07',
  totalAmount: 100000,
  items: [
    {
      categoryId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      categoryName: '食費',
      total: 60000,
      count: 12,
      percentage: 60,
    },
    {
      categoryId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
      categoryName: '娯楽',
      total: 40000,
      count: 3,
      percentage: 40,
    },
  ],
})

const emptyData = CategoryBreakdownViewSchema.parse({
  mode: 'household',
  yearMonth: '2026-06',
  totalAmount: 0,
  items: [],
})

const categoryColors = { 食費: '#ff6f90' }

describe('CategoryBreakdown', () => {
  it('凡例にカテゴリ名・金額・パーセンテージを表示する', () => {
    render(<CategoryBreakdown data={data} categoryColors={categoryColors} />)

    expect(screen.getByText('食費')).toBeInTheDocument()
    expect(screen.getByText('¥60,000')).toBeInTheDocument()
    expect(screen.getByText('60.0%')).toBeInTheDocument()
    expect(screen.getByText('娯楽')).toBeInTheDocument()
    expect(screen.getByText('¥40,000')).toBeInTheDocument()
    expect(screen.getByText('40.0%')).toBeInTheDocument()
  })

  it('テーマ色があればそれを、なければフォールバック色を使う', () => {
    const { container } = render(<CategoryBreakdown data={data} categoryColors={categoryColors} />)

    const circles = container.querySelectorAll('circle')
    expect(circles[0]).toHaveAttribute('stroke', '#ff6f90')
    expect(circles[1]).toHaveAttribute('stroke', FALLBACK_CATEGORY_COLORS[1])
  })

  it('凡例は取引一覧への Deep Link（表示中の月 + カテゴリ）になっている', () => {
    render(<CategoryBreakdown data={data} categoryColors={categoryColors} />)

    const foodLink = screen.getByRole('link', { name: /食費/ })
    expect(foodLink).toHaveAttribute(
      'href',
      '/transactions?month=2026-07&categoryId=01ARZ3NDEKTSV4RRFFQ69G5FAV',
    )
    const leisureLink = screen.getByRole('link', { name: /娯楽/ })
    expect(leisureLink).toHaveAttribute(
      'href',
      '/transactions?month=2026-07&categoryId=01BX5ZZKBKACTAV9WEVGEMMVRZ',
    )
  })

  it('支出が無い月はドーナツと凡例の代わりに空状態の案内を表示する', () => {
    const { container } = render(
      <CategoryBreakdown data={emptyData} categoryColors={categoryColors} />,
    )

    // 月・モードの切り替えは画面遷移を伴わないため、読み上げ対象でないとグラフが消えたことが伝わらない
    expect(screen.getByRole('status')).toHaveTextContent('この月の世帯支出はありません')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('個人モードの空状態は個人支出の文言になる', () => {
    const personalEmptyData = CategoryBreakdownViewSchema.parse({
      mode: 'personal',
      yearMonth: '2026-06',
      totalAmount: 0,
      items: [],
    })

    render(<CategoryBreakdown data={personalEmptyData} categoryColors={categoryColors} />)

    expect(screen.getByText('この月の個人支出はありません')).toBeInTheDocument()
  })

  it('支出がある月はドーナツと凡例を描画する（空状態にならない）', () => {
    const { container } = render(<CategoryBreakdown data={data} categoryColors={categoryColors} />)

    expect(screen.queryByText(/支出はありません/)).not.toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('svg')).not.toBeNull()
  })
})
