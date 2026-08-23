import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DashboardKpisViewSchema } from '@warimaru/domain'
import { KpiGrid } from '../KpiGrid'

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
})
