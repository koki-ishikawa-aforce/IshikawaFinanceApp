import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SpousePersonalNote } from '../SpousePersonalNote'

describe('SpousePersonalNote', () => {
  it('darling テーマではパートナー(Honey)のアイコン・ラベル・金額を表示する', () => {
    render(<SpousePersonalNote amount={45000} theme="darling" />)

    expect(screen.getByText(/Honeyの個人費/)).toBeInTheDocument()
    expect(screen.getByText('¥45,000')).toBeInTheDocument()
  })

  it('honey テーマではパートナー(Darling)のアイコン・ラベル・金額を表示する', () => {
    render(<SpousePersonalNote amount={64000} theme="honey" />)

    expect(screen.getByText(/Darlingの個人費/)).toBeInTheDocument()
    expect(screen.getByText('¥64,000')).toBeInTheDocument()
  })

  it('role=note でアクセシブルな説明を提供する', () => {
    render(<SpousePersonalNote amount={12000} theme="darling" />)

    const note = screen.getByRole('note')
    expect(note).toHaveAttribute('aria-label', 'Honeyの個人費 合計 ¥12,000')
  })

  it('ロングタップ(contextmenu)でプライバシーヒントを表示する', () => {
    render(<SpousePersonalNote amount={30000} theme="darling" />)

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    const container = screen.getByRole('note')
    fireEvent.contextMenu(container)

    expect(screen.getByRole('tooltip')).toHaveTextContent('明細はパートナーのみ閲覧可')
  })

  it('ヒントをクリックすると閉じる', () => {
    render(<SpousePersonalNote amount={30000} theme="honey" />)

    const container = screen.getByRole('note')
    fireEvent.contextMenu(container)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tooltip'))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('金額 0 のときも正しく表示する', () => {
    render(<SpousePersonalNote amount={0} theme="darling" />)

    expect(screen.getByText('¥0')).toBeInTheDocument()
  })
})
