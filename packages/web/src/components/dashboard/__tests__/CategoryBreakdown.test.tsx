import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CategoryBreakdownViewSchema } from '@warimaru/domain'
import { FALLBACK_CATEGORY_COLORS } from '@/theme/tokens'
import { CategoryBreakdown } from '../CategoryBreakdown'

const data = CategoryBreakdownViewSchema.parse({
  mode: 'household',
  yearMonth: '2026-07',
  totalAmount: 100000,
  items: [
    {
      categoryId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      categoryName: '食費',
      total: 60000,
      count: 12,
      percentage: 60,
    },
    {
      categoryId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
      categoryName: '娯楽',
      total: 40000,
      count: 3,
      percentage: 40,
    },
  ],
})

const emptyData = CategoryBreakdownViewSchema.parse({
  mode: 'household',
  yearMonth: '2026-06',
  totalAmount: 0,
  items: [],
})

// 返金による相殺で合計が 0 円になった月（支出の記録自体はある）
const zeroTotalData = CategoryBreakdownViewSchema.parse({
  mode: 'household',
  yearMonth: '2026-05',
  totalAmount: 0,
  items: [
    {
      categoryId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      categoryName: '食費',
      total: 5000,
      count: 2,
      percentage: 0,
    },
    {
      categoryId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
      categoryName: '娯楽',
      total: -5000,
      count: 1,
      percentage: 0,
    },
  ],
})

const categoryColors = { 食費: '#ff6f90' }

describe('CategoryBreakdown', () => {
  it('凡例にカテゴリ名・金額・パーセンテージを表示する', () => {
    render(<CategoryBreakdown data={data} categoryColors={categoryColors} />)

    expect(screen.getByText('食費')).toBeInTheDocument()
    expect(screen.getByText('60,000円')).toBeInTheDocument()
    expect(screen.getByText('60.0%')).toBeInTheDocument()
    expect(screen.getByText('娯楽')).toBeInTheDocument()
    expect(screen.getByText('40,000円')).toBeInTheDocument()
    expect(screen.getByText('40.0%')).toBeInTheDocument()
  })

  it('テーマ色があればそれを、なければフォールバック色を使う', () => {
    const { container } = render(<CategoryBreakdown data={data} categoryColors={categoryColors} />)

    const circles = container.querySelectorAll('circle')
    expect(circles[0]).toHaveAttribute('stroke', '#ff6f90')
    expect(circles[1]).toHaveAttribute('stroke', FALLBACK_CATEGORY_COLORS[1])
  })

  it('凡例は取引一覧への Deep Link（表示中の月 + カテゴリ）になっている', () => {
    render(<CategoryBreakdown data={data} categoryColors={categoryColors} />)

    const foodLink = screen.getByRole('link', { name: /食費/ })
    expect(foodLink).toHaveAttribute(
      'href',
      '/transactions?month=2026-07&categoryId=01ARZ3NDEKTSV4RRFFQ69G5FAV',
    )
    const leisureLink = screen.getByRole('link', { name: /娯楽/ })
    expect(leisureLink).toHaveAttribute(
      'href',
      '/transactions?month=2026-07&categoryId=01BX5ZZKBKACTAV9WEVGEMMVRZ',
    )
  })

  it('支出が無い月はドーナツと凡例の代わりに空状態の案内を表示する', () => {
    const { container } = render(
      <CategoryBreakdown data={emptyData} categoryColors={categoryColors} />,
    )

    // 月・モードの切り替えは画面遷移を伴わないため、読み上げ対象でないとグラフが消えたことが伝わらない
    expect(screen.getByRole('status')).toHaveTextContent('この月の世帯支出はありません')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(container.querySelector('circle')).toBeNull()
  })

  it('個人モードの空状態は個人支出の文言になる', () => {
    const personalEmptyData = CategoryBreakdownViewSchema.parse({
      mode: 'personal',
      yearMonth: '2026-06',
      totalAmount: 0,
      items: [],
    })

    render(<CategoryBreakdown data={personalEmptyData} categoryColors={categoryColors} />)

    expect(screen.getByText('この月の個人支出はありません')).toBeInTheDocument()
  })

  it('支出がある月はドーナツと凡例を描画する（空状態にならない）', () => {
    const { container } = render(<CategoryBreakdown data={data} categoryColors={categoryColors} />)

    expect(screen.queryByText(/支出はありません/)).not.toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('circle')).not.toBeNull()
  })

  it('支出はあるが合計0円の月はドーナツと中央の合計表示を出さない', () => {
    const { container } = render(
      <CategoryBreakdown data={zeroTotalData} categoryColors={categoryColors} />,
    )

    // 凡例の送り記号もアイコン(SVG)になったため、ドーナツの有無は svg ではなく弧の circle で見る
    expect(container.querySelector('circle')).toBeNull()
    // ドーナツ中央の「合計 / 0円」も一緒に消える（合計は KPI 側に出る）
    expect(screen.queryByText('合計')).not.toBeInTheDocument()
    expect(screen.queryByText('0円')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'この月は返金などで世帯支出の合計が0円になったため、内訳グラフは表示していません',
      ),
    ).toBeInTheDocument()
  })

  it('支出はあるが合計0円の月もカテゴリ一覧（名前・金額・遷移先）は残る', () => {
    render(<CategoryBreakdown data={zeroTotalData} categoryColors={categoryColors} />)

    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('食費')).toBeInTheDocument()
    expect(screen.getByText('5,000円')).toBeInTheDocument()
    expect(screen.getByText('娯楽')).toBeInTheDocument()
    expect(screen.getByText('-5,000円')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /食費/ })).toHaveAttribute(
      'href',
      '/transactions?month=2026-05&categoryId=01ARZ3NDEKTSV4RRFFQ69G5FAV',
    )
  })

  it('支出はあるが合計0円の月は意味を持たない 0.0% を表示しない', () => {
    render(<CategoryBreakdown data={zeroTotalData} categoryColors={categoryColors} />)

    expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
    expect(screen.queryAllByText(/%$/)).toHaveLength(0)
  })

  it('合計0円でも支出が1件も無い月は従来どおり空状態の案内を出す（グラフ非表示の案内にしない）', () => {
    render(<CategoryBreakdown data={emptyData} categoryColors={categoryColors} />)

    expect(screen.getByText('この月の世帯支出はありません')).toBeInTheDocument()
    expect(screen.queryByText(/内訳グラフは表示していません/)).not.toBeInTheDocument()
  })

  it('合計が0円でない月は割合表示が残る', () => {
    render(<CategoryBreakdown data={data} categoryColors={categoryColors} />)

    expect(screen.getByText('60.0%')).toBeInTheDocument()
    expect(screen.queryByText(/内訳グラフは表示していません/)).not.toBeInTheDocument()
  })

  it('個人モードで合計0円のときは個人支出の文言になる', () => {
    const personalZeroTotalData = CategoryBreakdownViewSchema.parse({
      ...zeroTotalData,
      mode: 'personal',
    })

    render(<CategoryBreakdown data={personalZeroTotalData} categoryColors={categoryColors} />)

    expect(
      screen.getByText(
        'この月は返金などで個人支出の合計が0円になったため、内訳グラフは表示していません',
      ),
    ).toBeInTheDocument()
  })

  // 合計が負になる月（返金が支出を上回る）は #340 の決定「合計0円」の範囲外。
  // 判定条件を誤って <= 0 に広げたことに気づけるよう、現行挙動を固定する
  it('合計が負の月は現状ドーナツと割合を表示する（0円判定を負値へ広げていない）', () => {
    const negativeTotalData = CategoryBreakdownViewSchema.parse({
      mode: 'household',
      yearMonth: '2026-04',
      totalAmount: -3000,
      items: [
        {
          categoryId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
          categoryName: '食費',
          total: 2000,
          count: 1,
          percentage: 0,
        },
        {
          categoryId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
          categoryName: '娯楽',
          total: -5000,
          count: 1,
          percentage: 100,
        },
      ],
    })

    const { container } = render(
      <CategoryBreakdown data={negativeTotalData} categoryColors={categoryColors} />,
    )

    expect(container.querySelector('circle')).not.toBeNull()
    expect(screen.getByText('100.0%')).toBeInTheDocument()
    expect(screen.queryByText(/内訳グラフは表示していません/)).not.toBeInTheDocument()
  })

  it('グラフと案内文が入れ替わる領域は支援技術に通知される', () => {
    const { rerender } = render(<CategoryBreakdown data={data} categoryColors={categoryColors} />)

    expect(screen.getByRole('status')).toBeInTheDocument()

    rerender(<CategoryBreakdown data={zeroTotalData} categoryColors={categoryColors} />)
    expect(screen.getByRole('status')).toHaveTextContent('内訳グラフは表示していません')

    rerender(<CategoryBreakdown data={emptyData} categoryColors={categoryColors} />)
    expect(screen.getByRole('status')).toHaveTextContent('この月の世帯支出はありません')
  })
})
