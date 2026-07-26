import { describe, expect, it } from 'vitest'
import { PdfConversionFailureReasonSchema } from '@warimaru/domain'
import {
  NOT_A_PDF_MESSAGE,
  UNSUPPORTED_FILE_MESSAGE,
  describeImportFailure,
  detectUploadFormat,
  uploadPath,
} from '../import-upload'

function file(name: string, type = ''): File {
  return new File(['dummy'], name, { type })
}

describe('detectUploadFormat', () => {
  it('拡張子で CSV / PDF を判別する', () => {
    expect(detectUploadFormat(file('statement.csv'))).toBe('csv')
    expect(detectUploadFormat(file('statement.pdf'))).toBe('pdf')
  })

  it('大文字拡張子でも判別する', () => {
    expect(detectUploadFormat(file('STATEMENT.PDF'))).toBe('pdf')
    expect(detectUploadFormat(file('STATEMENT.CSV'))).toBe('csv')
  })

  it('拡張子が無い場合は MIME で判別する', () => {
    expect(detectUploadFormat(file('statement', 'application/pdf'))).toBe('pdf')
    expect(detectUploadFormat(file('statement', 'text/csv'))).toBe('csv')
  })

  it('対応外のファイルは null を返す（アップロードさせない）', () => {
    expect(detectUploadFormat(file('statement.txt', 'text/plain'))).toBeNull()
    expect(detectUploadFormat(file('statement.xlsx'))).toBeNull()
    expect(detectUploadFormat(file('photo.pdf.png', 'image/png'))).toBeNull()
  })
})

describe('uploadPath', () => {
  it('形式ごとに別のエンドポイントへ送る', () => {
    expect(uploadPath('csv')).toBe('/api/imports/csv')
    expect(uploadPath('pdf')).toBe('/api/imports/pdf')
  })
})

describe('describeImportFailure', () => {
  it('PDF 変換失敗の理由ごとに異なる文言を返す', () => {
    const messages = PdfConversionFailureReasonSchema.options.map(reason =>
      describeImportFailure({
        kind: 'pdf_conversion_failed',
        reason,
        failureDetail: '詳細',
      }),
    )

    expect(new Set(messages).size).toBe(PdfConversionFailureReasonSchema.options.length)
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0)
      // 次の行動を示す（usability §3-6）
      expect(message).toMatch(/ください/)
    }
  })

  it('検証不一致では取込を中止したことを伝える', () => {
    const rowMismatch = describeImportFailure({
      kind: 'pdf_conversion_failed',
      reason: 'row_count_mismatch',
      failureDetail: '明細行数が一致しない（抽出 1 行 / 記載 2 行）',
    })
    const amountMismatch = describeImportFailure({
      kind: 'pdf_conversion_failed',
      reason: 'total_amount_mismatch',
      failureDetail: '合計金額が一致しない',
    })

    expect(rowMismatch).toContain('中止')
    expect(amountMismatch).toContain('中止')
  })

  it('未知の変換失敗理由でも詳細を落とさずに表示する', () => {
    const message = describeImportFailure({
      kind: 'pdf_conversion_failed',
      reason: 'unknown_future_reason',
      failureDetail: 'サーバー側で追加された理由',
    })

    expect(message).toContain('サーバー側で追加された理由')
  })

  it('構造化理由が欠けた PDF 変換失敗でも詳細を表示する', () => {
    const message = describeImportFailure({
      kind: 'pdf_conversion_failed',
      failureDetail: '理由フィールドなし',
    })

    expect(message).toContain('理由フィールドなし')
  })

  it('CSV 形式検証の失敗は行番号などの詳細を含めて表示する', () => {
    const message = describeImportFailure({
      kind: 'format_validation_failed',
      failureDetail: '3 行目: 金額が不正である: abc',
    })

    expect(message).toContain('3 行目: 金額が不正である: abc')
    expect(message).toContain('CSV')
  })

  it('取込中エラーは再アップロードを促す', () => {
    const message = describeImportFailure({
      kind: 'import_error',
      failureDetail: 'DB 接続に失敗',
    })

    expect(message).toContain('DB 接続に失敗')
    expect(message).toContain('もう一度')
  })
})

describe('選択・送信を拒否したときの文言', () => {
  it('対応外ファイルと PDF 不正はそれぞれ別の案内を出す', () => {
    expect(UNSUPPORTED_FILE_MESSAGE).toContain('.pdf')
    expect(NOT_A_PDF_MESSAGE).toContain('PDF')
    expect(UNSUPPORTED_FILE_MESSAGE).not.toBe(NOT_A_PDF_MESSAGE)
  })
})
