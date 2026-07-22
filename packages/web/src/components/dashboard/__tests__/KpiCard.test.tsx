import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KpiCard } from '../KpiCard'

describe('KpiCard', () => {
  it('ラベルと整形済み金額を表示する', () => {
    render(<KpiCard label="今月支出" value={123456} />)

    expect(screen.getByText('今月支出')).toBeInTheDocument()
    expect(screen.getByText('¥123,456')).toBeInTheDocument()
  })

  it('通常カードには装飾絵文字を表示しない', () => {
    render(<KpiCard label="貯蓄残高" value={0} />)

    expect(screen.queryByText('✨')).not.toBeInTheDocument()
  })

  it('ヒーローカードにはテーマの装飾絵文字を表示する(既定テーマは darling)', () => {
    render(<KpiCard label="総資産" value={9999999} isHero />)

    expect(screen.getByText('✨')).toBeInTheDocument()
    expect(screen.getByText('¥9,999,999')).toBeInTheDocument()
  })
})
