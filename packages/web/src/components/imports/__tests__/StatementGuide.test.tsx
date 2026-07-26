import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StatementFileKindSchema, YearMonthSchema } from '@warimaru/domain'
import { StatementGuide } from '../StatementGuide'

const openExternal = vi.hoisted(() => vi.fn())
vi.mock('@/lib/liff', () => ({ openExternal }))

const ym = (value: string) => YearMonthSchema.parse(value)

const CARD_TOGGLE = /三井住友カード.*取得方法/
const BANK_TOGGLE = /三井住友銀行.*取得方法/

const CARD_URL = 'https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202607'
const BANK_URL = 'https://direct3.smbc.co.jp/sp/web/'

beforeEach(() => {
  openExternal.mockClear()
})

describe('StatementGuide（三井住友カード）', () => {
  it('取得手順は畳まれた状態で始まり、開くと最後まで手順が出る', async () => {
    const user = userEvent.setup()
    render(<StatementGuide fileKind="card_statement" month={ym('2026-07')} />)

    const toggle = screen.getByRole('button', { name: CARD_TOGGLE })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    // 件数だけでは文言の取り違えを検出できないため、CSV に到達する最終手順を固定する
    expect(
      screen.getByText('「ご利用明細データダウンロード」から CSV を保存する'),
    ).toBeInTheDocument()
  })

  it('もう一度押すと畳んだ状態に戻る', async () => {
    const user = userEvent.setup()
    render(<StatementGuide fileKind="card_statement" month={ym('2026-07')} />)

    const toggle = screen.getByRole('button', { name: CARD_TOGGLE })
    await user.click(toggle)
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('リンクを押すと対象月付きの URL を外部ブラウザで開く', async () => {
    const user = userEvent.setup()
    render(<StatementGuide fileKind="card_statement" month={ym('2026-07')} />)

    await user.click(screen.getByRole('button', { name: CARD_TOGGLE }))
    await user.click(screen.getByRole('button', { name: /明細ページを開く/ }))

    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(CARD_URL)
  })

  it('1 桁の月も 2 桁ゼロ埋めのまま URL に載る', async () => {
    const user = userEvent.setup()
    render(<StatementGuide fileKind="card_statement" month={ym('2026-01')} />)

    await user.click(screen.getByRole('button', { name: CARD_TOGGLE }))
    await user.click(screen.getByRole('button', { name: /明細ページを開く/ }))

    expect(openExternal).toHaveBeenCalledWith(
      'https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202601',
    )
  })

  it('対象月が変わると案内文と開く URL の両方が追随する', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<StatementGuide fileKind="card_statement" month={ym('2026-07')} />)

    await user.click(screen.getByRole('button', { name: CARD_TOGGLE }))
    rerender(<StatementGuide fileKind="card_statement" month={ym('2026-05')} />)

    expect(screen.getByText(/2026年5月分の明細ページが開きます/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /明細ページを開く/ }))

    expect(openExternal).toHaveBeenCalledWith(
      'https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202605',
    )
  })

  it('月に依存する案内文は読み上げ対象になっている', async () => {
    const user = userEvent.setup()
    render(<StatementGuide fileKind="card_statement" month={ym('2026-07')} />)

    await user.click(screen.getByRole('button', { name: CARD_TOGGLE }))

    expect(screen.getByRole('status')).toHaveTextContent('2026年7月分の明細ページが開きます')
  })
})

describe('StatementGuide（三井住友銀行）', () => {
  it('取得手順として 4 ステップを出し、最終手順を明示する', async () => {
    const user = userEvent.setup()
    render(<StatementGuide fileKind="bank_statement" month={ym('2026-07')} />)

    await user.click(screen.getByRole('button', { name: BANK_TOGGLE }))

    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('「明細を CSV ダウンロード」から CSV を保存する')).toBeInTheDocument()
  })

  it('月を指定して開けないため、URL に月を埋め込まず制約を明示する', async () => {
    const user = userEvent.setup()
    render(<StatementGuide fileKind="bank_statement" month={ym('2026-07')} />)

    await user.click(screen.getByRole('button', { name: BANK_TOGGLE }))
    expect(screen.getByText(/月を指定して開くことはできません/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /SMBC ダイレクトを開く/ }))

    expect(openExternal).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(BANK_URL)
  })
})

describe('取込画面と同じ 2 枚並べたとき', () => {
  const renderBoth = (month: string) => (
    <>
      {StatementFileKindSchema.options.map(kind => (
        <StatementGuide key={kind} fileKind={kind} month={ym(month)} />
      ))}
    </>
  )

  it('カード・銀行の 2 枚が出て、どちらにも対象月が反映される', async () => {
    const user = userEvent.setup()
    render(renderBoth('2026-05'))

    const cardToggle = screen.getByRole('button', { name: CARD_TOGGLE })
    const bankToggle = screen.getByRole('button', { name: BANK_TOGGLE })
    await user.click(cardToggle)
    await user.click(bankToggle)

    expect(screen.getByText(/2026年5月分の明細ページが開きます/)).toBeInTheDocument()
    expect(screen.getByText(/ログイン後に2026年5月を表示してから/)).toBeInTheDocument()
  })

  it('片方を開いても、もう片方は畳まれたままで本文も混ざらない', async () => {
    const user = userEvent.setup()
    render(renderBoth('2026-07'))

    const cardToggle = screen.getByRole('button', { name: CARD_TOGGLE })
    const bankToggle = screen.getByRole('button', { name: BANK_TOGGLE })
    await user.click(cardToggle)

    expect(bankToggle).toHaveAttribute('aria-expanded', 'false')

    // aria-controls が 2 枚で衝突していれば、開いた側の本文に相手の手順が混ざる
    const cardBodyId = cardToggle.getAttribute('aria-controls')
    expect(cardBodyId).not.toBe(bankToggle.getAttribute('aria-controls'))

    const cardBody = document.getElementById(cardBodyId ?? '')
    expect(cardBody).not.toBeNull()
    expect(
      within(cardBody as HTMLElement).getByText(
        '「ご利用明細データダウンロード」から CSV を保存する',
      ),
    ).toBeInTheDocument()
    expect(
      within(cardBody as HTMLElement).queryByText('SMBC ダイレクトにログインする'),
    ).not.toBeInTheDocument()
  })
})
