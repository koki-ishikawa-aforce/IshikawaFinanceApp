import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { YearMonthSchema } from '@warimaru/domain'
import { StatementGuide, cardStatementUrl } from '../StatementGuide'

const openExternal = vi.hoisted(() => vi.fn())
vi.mock('@/lib/liff', () => ({ openExternal }))

const ym = (value: string) => YearMonthSchema.parse(value)

beforeEach(() => {
  openExternal.mockClear()
})

describe('cardStatementUrl', () => {
  it('対象月を YYYYMM のクエリ p01 として埋め込む', () => {
    expect(cardStatementUrl(ym('2026-07'))).toBe(
      'https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202607',
    )
  })

  it('1 桁の月も 2 桁ゼロ埋めのまま埋め込む', () => {
    expect(cardStatementUrl(ym('2026-01'))).toContain('p01=202601')
  })
})

describe('StatementGuide（三井住友カード）', () => {
  it('取得手順は畳まれた状態で始まり、開くと 3 ステップが出る', async () => {
    const user = userEvent.setup()
    render(<StatementGuide source="card" month={ym('2026-07')} />)

    const toggle = screen.getByRole('button', { name: /三井住友カード.*取得方法/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('リンクを押すと対象月付きの URL を外部ブラウザで開く', async () => {
    const user = userEvent.setup()
    render(<StatementGuide source="card" month={ym('2026-07')} />)

    await user.click(screen.getByRole('button', { name: /三井住友カード.*取得方法/ }))
    await user.click(screen.getByRole('button', { name: /明細ページを開く/ }))

    expect(openExternal).toHaveBeenCalledWith(
      'https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202607',
    )
  })

  it('対象月が変わると開く URL も追随する', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<StatementGuide source="card" month={ym('2026-07')} />)

    await user.click(screen.getByRole('button', { name: /三井住友カード.*取得方法/ }))
    rerender(<StatementGuide source="card" month={ym('2026-05')} />)
    await user.click(screen.getByRole('button', { name: /明細ページを開く/ }))

    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('p01=202605'))
    expect(screen.getByText(/2026年5月分の明細ページが開きます/)).toBeInTheDocument()
  })
})

describe('StatementGuide（三井住友銀行）', () => {
  it('取得手順として 4 ステップを出す', async () => {
    const user = userEvent.setup()
    render(<StatementGuide source="bank" month={ym('2026-07')} />)

    await user.click(screen.getByRole('button', { name: /三井住友銀行.*取得方法/ }))

    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('月を指定して開けないため、URL に月を埋め込まず制約を明示する', async () => {
    const user = userEvent.setup()
    render(<StatementGuide source="bank" month={ym('2026-07')} />)

    await user.click(screen.getByRole('button', { name: /三井住友銀行.*取得方法/ }))
    expect(screen.getByText(/月を指定して開くことはできません/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /SMBC ダイレクトを開く/ }))

    expect(openExternal).toHaveBeenCalledWith('https://direct3.smbc.co.jp/sp/web/')
    expect(openExternal).not.toHaveBeenCalledWith(expect.stringContaining('202607'))
  })
})
