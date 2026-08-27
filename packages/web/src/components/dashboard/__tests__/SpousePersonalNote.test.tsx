import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SpousePersonalNote } from '../SpousePersonalNote'

describe('SpousePersonalNote', () => {
  it('darling テーマ・ニックネーム未取得ではロール名(Honey)で表示する', () => {
    const { container } = render(
      <SpousePersonalNote amount={45000} theme="darling" partnerNickname={null} />,
    )

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText(/Honeyの個人費/)).toBeInTheDocument()
    expect(screen.getByText('45,000円')).toBeInTheDocument()
  })

  it('honey テーマ・ニックネーム未取得ではロール名(Darling)で表示する', () => {
    const { container } = render(
      <SpousePersonalNote amount={64000} theme="honey" partnerNickname={null} />,
    )

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText(/Darlingの個人費/)).toBeInTheDocument()
    expect(screen.getByText('64,000円')).toBeInTheDocument()
  })

  it('相手のニックネームが取れていれば、ロール名の代わりにニックネームで表示する(#596)', () => {
    render(<SpousePersonalNote amount={45000} theme="darling" partnerNickname="ななみ" />)

    expect(screen.getByText(/ななみの個人費/)).toBeInTheDocument()
    expect(screen.queryByText(/Honeyの個人費/)).not.toBeInTheDocument()
  })

  it('role=note でアクセシブルな説明を提供する', () => {
    render(<SpousePersonalNote amount={12000} theme="darling" partnerNickname={null} />)

    const note = screen.getByRole('note')
    expect(note).toHaveAttribute('aria-label', 'Honeyの個人費 合計 12,000円')
  })

  it('ロングタップ(contextmenu)でプライバシーヒントを表示する', () => {
    render(<SpousePersonalNote amount={30000} theme="darling" partnerNickname={null} />)

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    const container = screen.getByRole('note')
    fireEvent.contextMenu(container)

    expect(screen.getByRole('tooltip')).toHaveTextContent('明細はパートナーのみ閲覧可')
  })

  it('ヒント内の閉じるボタンを押すと閉じる(#611)', () => {
    render(<SpousePersonalNote amount={30000} theme="honey" partnerNickname={null} />)

    const container = screen.getByRole('note')
    fireEvent.contextMenu(container)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('ヒントの本文をクリックしても閉じない(閉じる操作はボタンに分離。#611)', () => {
    render(<SpousePersonalNote amount={30000} theme="honey" partnerNickname={null} />)

    const container = screen.getByRole('note')
    fireEvent.contextMenu(container)

    fireEvent.click(screen.getByRole('tooltip'))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })

  it('ヒント表示中に Escape キーで閉じる', () => {
    render(<SpousePersonalNote amount={30000} theme="honey" partnerNickname={null} />)

    const container = screen.getByRole('note')
    fireEvent.contextMenu(container)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('button', { name: '閉じる' }), { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('金額 0 のときも正しく表示する', () => {
    render(<SpousePersonalNote amount={0} theme="darling" partnerNickname={null} />)

    expect(screen.getByText('0円')).toBeInTheDocument()
  })
})
