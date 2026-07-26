import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ImportJobCard } from '../ImportJobCard'
import type { ImportJobWire } from '@/lib/api-schemas'

function job(overrides: Partial<ImportJobWire> = {}): ImportJobWire {
  return {
    kind: 'completed',
    common: {
      importJobId: 'JOB1',
      targetMonth: '2026-07',
      fileKind: 'card_statement',
      fileFormat: 'csv',
      fileRef: 'FILE1',
    },
    ...overrides,
  }
}

describe('ImportJobCard', () => {
  it('進行状態を日本語のバッジで表示する', () => {
    render(<ImportJobCard job={job({ kind: 'pdf_converting', common: job().common })} />)

    expect(screen.getByText('PDF変換中')).toBeInTheDocument()
  })

  it('完了ジョブでは新規候補・重複除外の件数を表示する', () => {
    render(
      <ImportJobCard
        job={job({
          summary: {
            newCount: 12,
            autoClassifiedEstimateCount: 3,
            unclassifiedEstimateCount: 9,
            duplicateExcludedCount: 2,
          },
        })}
      />,
    )

    expect(screen.getByText('新規候補: 12 件')).toBeInTheDocument()
    expect(screen.getByText('重複除外: 2 件')).toBeInTheDocument()
  })

  it('PDF 変換失敗では構造化理由に対応する案内を表示する（失敗詳細をそのまま出さない）', () => {
    render(
      <ImportJobCard
        job={job({
          kind: 'failed',
          failureReason: {
            kind: 'pdf_conversion_failed',
            reason: 'total_amount_mismatch',
            failureDetail: '合計金額が一致しない（抽出 12,000 / 記載 13,000）',
          },
        })}
      />,
    )

    expect(screen.getByText('失敗')).toBeInTheDocument()
    expect(screen.getByText(/合計金額が PDF の記載と一致しませんでした/)).toBeInTheDocument()
    expect(screen.queryByText(/抽出 12,000/)).not.toBeInTheDocument()
  })

  it('CSV 形式検証の失敗では直し方が分かる詳細を表示する', () => {
    render(
      <ImportJobCard
        job={job({
          kind: 'failed',
          failureReason: {
            kind: 'format_validation_failed',
            failureDetail: '3 行目: 列数が不足している（日付,店名,金額 が必要）',
          },
        })}
      />,
    )

    expect(
      screen.getByText(/3 行目: 列数が不足している（日付,店名,金額 が必要）/),
    ).toBeInTheDocument()
  })

  it('失敗していないジョブではエラー文言を表示しない', () => {
    render(<ImportJobCard job={job()} />)

    expect(screen.getByText('取込完了')).toBeInTheDocument()
    expect(screen.queryByText(/失敗しました/)).not.toBeInTheDocument()
  })

  it('取込状態の差し替わりを支援技術へ通知する', () => {
    const { container } = render(<ImportJobCard job={job()} />)

    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument()
  })
})
