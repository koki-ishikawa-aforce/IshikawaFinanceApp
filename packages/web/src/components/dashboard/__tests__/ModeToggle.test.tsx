import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModeToggle } from '../ModeToggle'

describe('ModeToggle', () => {
  it('世帯/個人の2セグメントを表示する', () => {
    render(<ModeToggle mode="household" onModeChange={() => {}} />)

    expect(screen.getByRole('button', { name: '世帯' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '個人' })).toBeInTheDocument()
  })

  it('個人をクリックすると personal で通知する', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<ModeToggle mode="household" onModeChange={onModeChange} />)

    await user.click(screen.getByRole('button', { name: '個人' }))

    expect(onModeChange).toHaveBeenCalledWith('personal')
  })

  it('世帯をクリックすると household で通知する', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<ModeToggle mode="personal" onModeChange={onModeChange} />)

    await user.click(screen.getByRole('button', { name: '世帯' }))

    expect(onModeChange).toHaveBeenCalledWith('household')
  })
})
