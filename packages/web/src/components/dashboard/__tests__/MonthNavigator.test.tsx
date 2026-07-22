import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { YearMonthSchema } from '@warimaru/domain'
import { MonthNavigator } from '../MonthNavigator'

const ym = (value: string) => YearMonthSchema.parse(value)

describe('MonthNavigator', () => {
  it('対象月を YYYY年M月 形式で表示する', () => {
    render(<MonthNavigator month={ym('2026-07')} onMonthChange={() => {}} />)

    expect(screen.getByText('2026年7月')).toBeInTheDocument()
  })

  it('前月ボタンで前の月を通知する', async () => {
    const user = userEvent.setup()
    const onMonthChange = vi.fn()
    render(<MonthNavigator month={ym('2026-07')} onMonthChange={onMonthChange} />)

    await user.click(screen.getByRole('button', { name: '前月' }))

    expect(onMonthChange).toHaveBeenCalledWith('2026-06')
  })

  it('次月ボタンで次の月を通知する', async () => {
    const user = userEvent.setup()
    const onMonthChange = vi.fn()
    render(<MonthNavigator month={ym('2026-07')} onMonthChange={onMonthChange} />)

    await user.click(screen.getByRole('button', { name: '次月' }))

    expect(onMonthChange).toHaveBeenCalledWith('2026-08')
  })

  it('1月の前月は前年12月になる', async () => {
    const user = userEvent.setup()
    const onMonthChange = vi.fn()
    render(<MonthNavigator month={ym('2026-01')} onMonthChange={onMonthChange} />)

    await user.click(screen.getByRole('button', { name: '前月' }))

    expect(onMonthChange).toHaveBeenCalledWith('2025-12')
  })

  it('12月の次月は翌年1月になる', async () => {
    const user = userEvent.setup()
    const onMonthChange = vi.fn()
    render(<MonthNavigator month={ym('2026-12')} onMonthChange={onMonthChange} />)

    await user.click(screen.getByRole('button', { name: '次月' }))

    expect(onMonthChange).toHaveBeenCalledWith('2027-01')
  })
})
