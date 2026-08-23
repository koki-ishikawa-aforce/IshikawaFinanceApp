import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModeToggle } from '../ModeToggle'

describe('ModeToggle', () => {
  it('世帯/個人の2択を、まとまりの名前つきで表示する', () => {
    render(<ModeToggle mode="household" onModeChange={() => {}} />)

    const group = screen.getByRole('radiogroup', { name: '集計の範囲' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '世帯' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '個人' })).toBeInTheDocument()
  })

  it('選択中がラジオの状態として伝わる', () => {
    // 色の塗りだけで示すと、支援技術の利用者にはどちらを見ているか分からない(§6-9)
    render(<ModeToggle mode="personal" onModeChange={() => {}} />)

    expect(screen.getByRole('radio', { name: '個人' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '世帯' })).not.toBeChecked()
  })

  it('個人を選ぶと personal で通知する', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<ModeToggle mode="household" onModeChange={onModeChange} />)

    await user.click(screen.getByRole('radio', { name: '個人' }))

    expect(onModeChange).toHaveBeenCalledWith('personal')
  })

  it('世帯を選ぶと household で通知する', async () => {
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<ModeToggle mode="personal" onModeChange={onModeChange} />)

    await user.click(screen.getByRole('radio', { name: '世帯' }))

    expect(onModeChange).toHaveBeenCalledWith('household')
  })

  it('選択中をもう一度選んでも通知しない', async () => {
    // ラジオは選択中を再選択しても change が起きない。押すたびに再取得が走らないこと
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    render(<ModeToggle mode="household" onModeChange={onModeChange} />)

    await user.click(screen.getByRole('radio', { name: '世帯' }))

    expect(onModeChange).not.toHaveBeenCalled()
  })
})
