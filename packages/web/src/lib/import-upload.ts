/**
 * 明細ファイル（CSV / PDF）アップロードの振り分けと、失敗理由の画面文言。
 *
 * 失敗理由の集合はドメイン（`PdfConversionFailureReasonSchema` / `ImportJobFailureReasonSchema`）が
 * 単一ソースで、ここでは「利用者が次に何をすればよいか」への翻訳だけを行う。
 *
 * @see docs/domain/08a-ul-取引取込.md §2「PDFをCSVに変換する」
 * @see docs/design/usability.md §3-6（エラー文言は次の行動を示す）
 */
import { PdfConversionFailureReasonSchema, type PdfConversionFailureReason } from '@warimaru/domain'
import type { ImportJobFailureWire } from '@/lib/api-schemas'

export type UploadFormat = 'csv' | 'pdf'

const UPLOAD_PATHS: Record<UploadFormat, string> = {
  csv: '/api/imports/csv',
  pdf: '/api/imports/pdf',
}

/** 選択されたファイルの取込形式。対応外は null（呼び出し側でアップロードせずに拒否する） */
export function detectUploadFormat(file: File): UploadFormat | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return 'csv'
  if (name.endsWith('.pdf')) return 'pdf'
  // 拡張子が無い端末（一部の iOS 共有シート等）に備えて MIME でも判定する
  if (file.type === 'text/csv') return 'csv'
  if (file.type === 'application/pdf') return 'pdf'
  return null
}

export function uploadPath(format: UploadFormat): string {
  return UPLOAD_PATHS[format]
}

export const UNSUPPORTED_FILE_MESSAGE =
  '取込できるのは CSV(.csv)と明細 PDF(.pdf)です。別のファイルを選び直してください。'

/** `%PDF` シグネチャ不一致（API が 400 で返す）に対する画面文言 */
export const NOT_A_PDF_MESSAGE =
  'PDF として読み取れないファイルです。カード会社・銀行のサイトで保存した PDF を選び直してください。'

const PDF_CONVERSION_MESSAGES: Record<PdfConversionFailureReason, string> = {
  api_call_failed:
    'PDF の変換に失敗しました。通信状況を確認して、しばらくおいてからもう一度アップロードしてください。',
  invalid_response_structure:
    'PDF から明細を読み取れませんでした。明細のページだけを含む PDF か確認するか、CSV での取込をお試しください。',
  row_count_mismatch:
    '読み取った明細の件数が PDF の記載と一致しませんでした。取込は中止しています。ページの欠けが無いか確認するか、CSV での取込をお試しください。',
  total_amount_mismatch:
    '読み取った明細の合計金額が PDF の記載と一致しませんでした。取込は中止しています。CSV での取込をお試しください。',
  timeout:
    'PDF の変換が時間内に終わりませんでした。ページ数の少ない PDF に分けるか、しばらくおいてからもう一度お試しください。',
}

/**
 * 失敗ジョブを利用者向けの一文に翻訳する。
 * 未知の理由（サーバー先行デプロイで新しい値が増えた場合）は、握りつぶさず詳細をそのまま見せる。
 */
export function describeImportFailure(failure: ImportJobFailureWire): string {
  if (failure.kind === 'pdf_conversion_failed') {
    const reason = PdfConversionFailureReasonSchema.safeParse(failure.reason)
    return reason.success
      ? PDF_CONVERSION_MESSAGES[reason.data]
      : `PDF の変換に失敗しました（${failure.failureDetail}）。しばらくおいてからもう一度お試しください。`
  }
  if (failure.kind === 'format_validation_failed') {
    return `CSV の形式を確認できませんでした（${failure.failureDetail}）。カード会社・銀行のサイトからダウンロードした CSV をそのままアップロードしてください。`
  }
  return `取込中にエラーが発生しました（${failure.failureDetail}）。しばらくおいてからもう一度アップロードしてください。`
}
