import { describe, expect, it } from 'vitest'
import { PdfConversionFailureReasonSchema } from '@warimaru/domain'
import {
  NOT_A_PDF_MESSAGE,
  checkUploadFile,
  describeImportFailure,
  describeUploadError,
  detectUploadFormat,
  uploadPath,
} from '../import-upload'
import { NETWORK_ERROR_MESSAGE } from '@/lib/api-client'

function file(name: string, type = '', size = 10): File {
  return new File(['x'.repeat(size)], name, { type })
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

describe('checkUploadFile', () => {
  it('対応形式・上限内のファイルは形式つきで通す', () => {
    expect(checkUploadFile(file('statement.csv', 'text/csv', 1_000_000))).toEqual({
      ok: true,
      format: 'csv',
    })
    expect(checkUploadFile(file('statement.pdf', 'application/pdf', 10_000_000))).toEqual({
      ok: true,
      format: 'pdf',
    })
  })

  it('対応外の拡張子は理由つきで拒否する', () => {
    const result = checkUploadFile(file('statement.txt', 'text/plain'))

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toContain('.pdf')
  })

  // API の上限（CSV 1MB / PDF 10MB）を 1 バイト超えたところで拒否されること
  it('上限を超えたファイルは送らずにサイズを理由に拒否する', () => {
    const csv = checkUploadFile(file('statement.csv', 'text/csv', 1_000_001))
    const pdf = checkUploadFile(file('statement.pdf', 'application/pdf', 10_000_001))

    expect(csv.ok).toBe(false)
    expect(csv.ok === false && csv.message).toContain('1MB')
    expect(pdf.ok).toBe(false)
    expect(pdf.ok === false && pdf.message).toContain('10MB')
  })
})

describe('describeImportFailure', () => {
  it.each([
    ['api_call_failed', '変換サービスに繋がりませんでした'],
    ['invalid_response_structure', '明細のページだけを含む PDF'],
    ['row_count_mismatch', '件数が PDF の記載と一致しませんでした'],
    ['total_amount_mismatch', '合計金額が PDF の記載と一致しませんでした'],
    ['timeout', '時間内に終わりませんでした'],
  ] as const)('PDF 変換失敗 %s は固有の案内を出す', (reason, expected) => {
    const message = describeImportFailure({
      kind: 'pdf_conversion_failed',
      reason,
      failureDetail: '詳細',
    })

    expect(message).toContain(expected)
    // 次の行動を示す（usability §3-6）
    expect(message).toMatch(/ください/)
  })

  it('ドメインの変換失敗理由をすべて網羅している', () => {
    for (const reason of PdfConversionFailureReasonSchema.options) {
      const message = describeImportFailure({
        kind: 'pdf_conversion_failed',
        reason,
        failureDetail: '詳細',
      })
      expect(message).not.toContain('詳細')
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

  it('取込中エラーは内部例外の文言を出さずに再試行を促す', () => {
    const message = describeImportFailure({
      kind: 'import_error',
      failureDetail: 'connect ECONNREFUSED 10.0.0.1:5432',
    })

    expect(message).not.toContain('ECONNREFUSED')
    expect(message).toContain('もう一度')
  })
})

describe('describeUploadError', () => {
  it('送信前に拒否した理由は他のエラーより優先する', () => {
    const message = describeUploadError({
      selectionError: 'この形式は取り込めません',
      error: { status: 500, message: 'Internal server error' },
      hasJob: false,
    })

    expect(message).toBe('この形式は取り込めません')
  })

  it('PDF として読み取れない場合は選び直しを促す', () => {
    const message = describeUploadError({
      selectionError: null,
      error: { status: 400, message: 'file が PDF ではない', reason: 'not_a_pdf' },
      hasJob: false,
    })

    expect(message).toBe(NOT_A_PDF_MESSAGE)
  })

  it('理由の無い 400 は PDF の中身のせいだと決めつけない', () => {
    const message = describeUploadError({
      selectionError: null,
      error: { status: 400, message: '{"error":"Validation error"}' },
      hasJob: false,
    })

    expect(message).not.toBe(NOT_A_PDF_MESSAGE)
    expect(message).not.toContain('Validation error')
    expect(message).toContain('もう一度')
  })

  it('失敗ジョブが返っている場合は取込ジョブカードに任せて何も出さない', () => {
    const message = describeUploadError({
      selectionError: null,
      error: { status: 422, message: '{"job":{}}' },
      hasJob: true,
    })

    expect(message).toBeNull()
  })

  it('エラーが無ければ何も出さない', () => {
    expect(describeUploadError({ selectionError: null, error: null, hasJob: false })).toBeNull()
  })

  it('サーバーが返した失敗は、原因を添えて時間をおいた再試行を促す', () => {
    // 届いている以上、通信の確認を促しても利用者にできることは無い
    const message = describeUploadError({
      selectionError: null,
      error: { status: 500, message: 'Internal server error' },
      hasJob: false,
    })

    expect(message).toContain('Internal server error')
    expect(message).toContain('しばらくおいてから')
    expect(message).not.toContain('通信状況')
  })
})

describe('describeUploadError（通信できないとき）', () => {
  it('通信の失敗は共通の文言をそのまま出す', () => {
    const message = describeUploadError({
      selectionError: null,
      error: { message: NETWORK_ERROR_MESSAGE, network: true },
      hasJob: false,
    })

    expect(message).toBe(NETWORK_ERROR_MESSAGE)
  })

  it('失敗ジョブが返っていれば、通信の失敗でもここでは出さない（ジョブカードに任せる）', () => {
    const message = describeUploadError({
      selectionError: null,
      error: { message: NETWORK_ERROR_MESSAGE, network: true },
      hasJob: true,
    })

    expect(message).toBeNull()
  })

  it('通信の失敗はステータス付きの分岐より優先する', () => {
    // 届いていないのに「ファイルを確認して」と促すと、直しようのない行動へ誘導することになる
    const message = describeUploadError({
      selectionError: null,
      error: { status: 400, message: NETWORK_ERROR_MESSAGE, network: true },
      hasJob: false,
    })

    expect(message).toBe(NETWORK_ERROR_MESSAGE)
  })

  it('送信前に拒否した理由は通信の失敗より優先する', () => {
    const message = describeUploadError({
      selectionError: 'この形式は取り込めません',
      error: { message: NETWORK_ERROR_MESSAGE, network: true },
      hasJob: false,
    })

    expect(message).toBe('この形式は取り込めません')
  })
})
