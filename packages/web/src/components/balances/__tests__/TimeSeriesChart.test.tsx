import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TimeSeriesChart, type ChartSeries } from '../TimeSeriesChart'

function series(
  points: { date: string; amount: number; isCarriedForward?: boolean }[],
): ChartSeries {
  return {
    label: '貯蓄残高',
    cssColorVar: '--accent',
    points: points.map(p => ({
      date: new Date(p.date),
      amount: p.amount,
      isCarriedForward: p.isCarriedForward ?? false,
    })),
  }
}

describe('TimeSeriesChart', () => {
  it('描画できる点が1つも無いときは案内文を出し、チャートは描かない', () => {
    // 系列自体はあるが points が空、というケースも「描けない」に含める
    render(<TimeSeriesChart series={[series([]), series([])]} />)

    expect(screen.getByRole('status')).toHaveTextContent('表示できるデータがありません')
    expect(screen.queryByRole('img', { name: '資産推移チャート' })).not.toBeInTheDocument()
  })

  it('系列が1つも無いときも案内文を出す', () => {
    render(<TimeSeriesChart series={[]} />)

    expect(screen.getByRole('status')).toHaveTextContent('表示できるデータがありません')
  })

  it('点が1つでもあればチャートを描き、案内文は出さない', () => {
    render(<TimeSeriesChart series={[series([{ date: '2026-05-01', amount: 100 }])]} />)

    expect(screen.getByRole('img', { name: '資産推移チャート' })).toBeInTheDocument()
    expect(screen.queryByText('表示できるデータがありません')).not.toBeInTheDocument()
  })

  it('複数の点を結ぶ線の座標が数値になる（NaN を描かない）', () => {
    const { container } = render(
      <TimeSeriesChart
        series={[
          series([
            { date: '2026-05-01', amount: 100 },
            { date: '2026-06-01', amount: 300 },
          ]),
        ]}
      />,
    )

    const path = container.querySelector('path')
    expect(path?.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/)
  })

  it('点が1つだけでも座標が NaN にならない（期間・金額の幅が 0 のケース）', () => {
    const { container } = render(
      <TimeSeriesChart series={[series([{ date: '2026-05-01', amount: 0 }])]} />,
    )

    const circle = container.querySelector('circle')
    expect(Number(circle?.getAttribute('cx'))).not.toBeNaN()
    expect(Number(circle?.getAttribute('cy'))).not.toBeNaN()
  })

  it('期間の始まりの補助点（isCarriedForward）は線には含めるがドットは打たない（実際の記録と区別する。#538）', () => {
    const { container } = render(
      <TimeSeriesChart
        series={[
          series([
            { date: '2026-05-01', amount: 100, isCarriedForward: true },
            { date: '2026-05-20', amount: 100, isCarriedForward: false },
          ]),
        ]}
      />,
    )

    // 線は補助点も含めて2点分を結ぶ
    const path = container.querySelector('path')
    expect(path?.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/)
    // ドットは実際の記録の1点だけ
    expect(container.querySelectorAll('circle')).toHaveLength(1)
  })
})
