import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppNav } from '../AppNav'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('AppNav', () => {
  it('5つのナビ項目を表示する', () => {
    render(<AppNav />)

    expect(screen.getByText('ホーム')).toBeInTheDocument()
    expect(screen.getByText('取引')).toBeInTheDocument()
    expect(screen.getByText('レポート')).toBeInTheDocument()
    expect(screen.getByText('残高')).toBeInTheDocument()
    expect(screen.getByText('設定')).toBeInTheDocument()
  })

  it('使う頻度の低い精算・取込は含まない(#614。設定画面の入り口リンクへ移した)', () => {
    render(<AppNav />)

    expect(screen.queryByText('精算')).not.toBeInTheDocument()
    expect(screen.queryByText('取込')).not.toBeInTheDocument()
  })

  it('アイコンは絵文字ではなくSVGで描画される', () => {
    const { container } = render(<AppNav />)

    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(5)
  })

  it('アイコンにaria-hidden属性が付与されている', () => {
    const { container } = render(<AppNav />)

    const svgs = container.querySelectorAll('svg')
    svgs.forEach(svg => {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })
  })

  it('現在のページにaria-current="page"が付与される', () => {
    render(<AppNav />)

    const homeLink = screen.getByText('ホーム').closest('a')
    expect(homeLink).toHaveAttribute('aria-current', 'page')

    const transactionsLink = screen.getByText('取引').closest('a')
    expect(transactionsLink).not.toHaveAttribute('aria-current')
  })
})
