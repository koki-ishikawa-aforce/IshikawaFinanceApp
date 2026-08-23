import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from '../SegmentedControl'

const OPTIONS = [
  { value: 'card', label: 'カード利用明細' },
  { value: 'bank', label: '銀行入出金明細' },
] as const

function renderControl(value: 'card' | 'bank', onChange = vi.fn()) {
  render(
    <SegmentedControl label="ファイル種別" options={OPTIONS} value={value} onChange={onChange} />,
  )
  return onChange
}

describe('SegmentedControl', () => {
  it('選ばれている選択肢が仕組みとして伝わる', () => {
    renderControl('bank')

    // 見た目(色や太さ)ではなく checked で伝わることを固定する。画面読み上げが拾うのはこちら
    expect(screen.getByRole('radio', { name: 'カード利用明細' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: '銀行入出金明細' })).toBeChecked()
  })

  it('選択肢のまとまりに名前が付いている', () => {
    renderControl('card')

    expect(screen.getByRole('radiogroup', { name: 'ファイル種別' })).toBeInTheDocument()
  })

  it('選んでいない側を 1 回押すと切り替えが伝わる', async () => {
    const user = userEvent.setup()
    const onChange = renderControl('card')

    await user.click(screen.getByRole('radio', { name: '銀行入出金明細' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('bank')
  })

  it('選ばれている側を押しても切り替えを通知しない', async () => {
    const user = userEvent.setup()
    const onChange = renderControl('card')

    await user.click(screen.getByRole('radio', { name: 'カード利用明細' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('キーボードだけで選択肢を移動できる', async () => {
    const user = userEvent.setup()
    const onChange = renderControl('card')

    await user.tab()
    expect(screen.getByRole('radio', { name: 'カード利用明細' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledExactlyOnceWith('bank')
  })

  it('選択肢が 3 つでも同じように扱える', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SegmentedControl
        label="表示範囲"
        options={[
          { value: 'all', label: 'すべて' },
          { value: 'mine', label: '自分' },
          { value: 'partner', label: '相手' },
        ]}
        value="all"
        onChange={onChange}
      />,
    )

    expect(screen.getAllByRole('radio')).toHaveLength(3)

    await user.click(screen.getByRole('radio', { name: '相手' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('partner')
  })

  it('別の場所に同時に置いても選択が混ざらない', async () => {
    const user = userEvent.setup()
    const first = vi.fn()
    const second = vi.fn()
    render(
      <>
        <SegmentedControl label="上の切り替え" options={OPTIONS} value="card" onChange={first} />
        <SegmentedControl label="下の切り替え" options={OPTIONS} value="bank" onChange={second} />
      </>,
    )

    // ラジオは name 属性でまとまる。2 つの切り替えが同じ名前を共有すると、
    // 片方を押した瞬間にもう片方の選択が外れてしまう
    const lower = within(screen.getByRole('radiogroup', { name: '下の切り替え' }))
    await user.click(lower.getByRole('radio', { name: 'カード利用明細' }))

    expect(second).toHaveBeenCalledExactlyOnceWith('card')
    expect(first).not.toHaveBeenCalled()
    const upper = within(screen.getByRole('radiogroup', { name: '上の切り替え' }))
    expect(upper.getByRole('radio', { name: 'カード利用明細' })).toBeChecked()
  })
})
