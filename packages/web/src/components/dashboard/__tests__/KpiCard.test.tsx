import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { KpiCard } from '../KpiCard'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('KpiCard', () => {
  it('ラベルと整形済み金額を表示する', () => {
    render(<KpiCard label="今月支出" value={123456} />)

    expect(screen.getByText('今月支出')).toBeInTheDocument()
    expect(screen.getByText('123,456円')).toBeInTheDocument()
  })

  it('通常カードに装飾絵文字がない', () => {
    render(<KpiCard label="貯蓄残高" value={0} />)

    expect(screen.queryByText('✨')).not.toBeInTheDocument()
    expect(screen.queryByText('⭐')).not.toBeInTheDocument()
  })

  it('ヒーローカードは装飾を CSS で表現し、絵文字を使わない', () => {
    render(<KpiCard label="資産合計" value={9999999} isHero />)

    expect(screen.queryByText('✨')).not.toBeInTheDocument()
    expect(screen.queryByText('⭐')).not.toBeInTheDocument()
    expect(screen.getByText('9,999,999円')).toBeInTheDocument()
  })

  it('行き先を渡したカードだけがリンクになる（押せないカードを押せるように見せない）', () => {
    render(
      <>
        <KpiCard label="貯蓄残高" value={2000000} href="/balances" />
        <KpiCard label="今月支出" value={123456} />
      </>,
    )

    expect(screen.getByRole('link', { name: /貯蓄残高/ })).toHaveAttribute('href', '/balances')
    expect(screen.queryByRole('link', { name: /今月支出/ })).not.toBeInTheDocument()
  })
})
