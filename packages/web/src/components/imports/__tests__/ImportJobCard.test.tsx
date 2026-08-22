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
  it.each([
    ['upload_accepted', '受付済み'],
    ['pdf_converting', 'PDF変換中'],
    ['format_validating', 'フォーマット検証中'],
    ['importing', '取込中'],
    ['completed', '取込完了'],
    ['failed', '失敗'],
  ] as const)('進行状態 %s をバッジで表示する', (kind, label) => {
    render(<ImportJobCard job={job({ kind })} />)

    expect(screen.getByText(label)).toBeInTheDocument()
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

  // 同じファイルを再アップロードすると全件が三項一致で除外される（AT-308 手順5）
  it('新規候補が 0 件でも件数を表示する', () => {
    render(
      <ImportJobCard
        job={job({
          summary: {
            newCount: 0,
            autoClassifiedEstimateCount: 0,
            unclassifiedEstimateCount: 0,
            duplicateExcludedCount: 12,
          },
        })}
      />,
    )

    expect(screen.getByText('新規候補: 0 件')).toBeInTheDocument()
    expect(screen.getByText('重複除外: 12 件')).toBeInTheDocument()
  })

  it('進行中のジョブでは件数を表示しない', () => {
    render(<ImportJobCard job={job({ kind: 'pdf_converting' })} />)

    expect(screen.queryByText(/新規候補/)).not.toBeInTheDocument()
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
    expect(screen.getByRole('alert')).toHaveTextContent('合計金額が PDF の記載と一致しませんでした')
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

    expect(screen.getByRole('alert')).toHaveTextContent(
      '3 行目: 列数が不足している（日付,店名,金額 が必要）',
    )
  })

  it('失敗理由を持たないジョブではエラー領域自体を描画しない', () => {
    render(<ImportJobCard job={job()} />)

    expect(screen.getByText('取込完了')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('見出しでカードの内容を関連付ける', () => {
    render(<ImportJobCard job={job()} />)

    expect(screen.getByRole('region', { name: '取込ジョブ' })).toBeInTheDocument()
  })
})
