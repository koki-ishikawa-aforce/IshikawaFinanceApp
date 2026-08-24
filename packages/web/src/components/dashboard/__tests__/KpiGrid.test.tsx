import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { DashboardKpisViewSchema } from '@warimaru/domain'
import { KpiGrid } from '../KpiGrid'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const kpis = DashboardKpisViewSchema.parse({
  mode: 'household',
  currentMonthSpending: 123456,
  spousePersonalTotal: 45000,
  savingsBalance: 2000000,
  nisaContributionAccumulated: 500000,
  totalAssets: 2450000,
})

describe('KpiGrid', () => {
  it('KPI 4 タイルをラベル付きで表示する', () => {
    render(<KpiGrid kpis={kpis} />)

    expect(screen.getByText('今月支出')).toBeInTheDocument()
    expect(screen.getByText('貯蓄残高')).toBeInTheDocument()
    expect(screen.getByText('NISA積立累計')).toBeInTheDocument()
    expect(screen.getByText('資産合計')).toBeInTheDocument()
  })

  it('各タイルに対応する金額を表示する', () => {
    render(<KpiGrid kpis={kpis} />)

    expect(screen.getByText('123,456円')).toBeInTheDocument()
    expect(screen.getByText('2,000,000円')).toBeInTheDocument()
    expect(screen.getByText('500,000円')).toBeInTheDocument()
    expect(screen.getByText('2,450,000円')).toBeInTheDocument()
  })

  it('資産に関わる 3 タイルは残高一覧へ入れ、今月支出は押せないままにする（#406 / spec §5.5）', () => {
    render(<KpiGrid kpis={kpis} />)

    for (const label of ['貯蓄残高', 'NISA積立累計', '資産合計']) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toHaveAttribute(
        'href',
        '/balances',
      )
    }
    expect(screen.queryByRole('link', { name: /今月支出/ })).not.toBeInTheDocument()
  })
})
