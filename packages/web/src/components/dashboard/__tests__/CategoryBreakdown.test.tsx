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
})
