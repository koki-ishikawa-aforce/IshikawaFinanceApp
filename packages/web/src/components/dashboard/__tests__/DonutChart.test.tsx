import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DonutChart } from '../DonutChart'

const segments = [
  { label: '食費', percentage: 60, color: '#ff6f90' },
  { label: '娯楽', percentage: 40, color: '#ff9888' },
]

describe('DonutChart', () => {
  it('中央に合計金額を表示する', () => {
    render(<DonutChart segments={segments} totalAmount={80000} />)

    expect(screen.getByText('合計')).toBeInTheDocument()
    expect(screen.getByText('80,000円')).toBeInTheDocument()
  })

  it('セグメントごとに circle を描画する', () => {
    const { container } = render(<DonutChart segments={segments} totalAmount={80000} />)

    const circles = container.querySelectorAll('circle')
    expect(circles).toHaveLength(2)
    expect(circles[0]).toHaveAttribute('stroke', '#ff6f90')
    expect(circles[1]).toHaveAttribute('stroke', '#ff9888')
  })

  it('セグメントが空でも合計は表示する', () => {
    const { container } = render(<DonutChart segments={[]} totalAmount={0} />)

    expect(container.querySelectorAll('circle')).toHaveLength(0)
    expect(screen.getByText('0円')).toBeInTheDocument()
  })
})
