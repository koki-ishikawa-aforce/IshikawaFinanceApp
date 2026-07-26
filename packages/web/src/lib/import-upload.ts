/**
 * 明細ファイル（CSV / PDF）アップロードの振り分けと、失敗の画面文言。
 *
 * 失敗理由の集合はドメイン（`PdfConversionFailureReasonSchema` / `ImportJobFailureReasonSchema`）が
 * 単一ソースで、ここでは「利用者が次に何をすればよいか」への翻訳だけを行う。
 *
 * @see docs/domain/08a-ul-取引取込.md §2「PDFをCSVに変換する」
 * @see docs/design/usability.md §3-6（エラー文言は次の行動を示す）
 */
import {
  PdfConversionFailureReasonSchema,
  type PdfConversionFailureReason,
  type UploadFileFormat,
} from '@warimaru/domain'
import type { ImportJobFailureWire } from '@/lib/api-schemas'

const UPLOAD_PATHS: Record<UploadFileFormat, string> = {
  csv: '/api/imports/csv',
  pdf: '/api/imports/pdf',
}

/**
 * 送信前に弾くファイルサイズ上限。API 側の上限（`packages/api/src/routes/imports.ts` の
 * `MAX_CSV_FILE_SIZE` / `MAX_PDF_FILE_SIZE`）と同値を持つ。サーバーの検証を置き換えるものではなく、
 * 「10MB の PDF を数十秒かけて送ってから拒否される」体験を避けるための事前チェック。
 */
const MAX_UPLOAD_BYTES: Record<UploadFileFormat, number> = {
  csv: 1_000_000,
  pdf: 10_000_000,
}

const SIZE_LIMIT_LABELS: Record<UploadFileFormat, string> = {
  csv: '1MB',
  pdf: '10MB',
}

/** 選択されたファイルの取込形式。対応外は null（呼び出し側でアップロードせずに拒否する） */
export function detectUploadFormat(file: File): UploadFileFormat | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) return 'csv'
  if (name.endsWith('.pdf')) return 'pdf'
  // 拡張子が無い端末（一部の iOS 共有シート等）に備えて MIME でも判定する
  if (file.type === 'text/csv') return 'csv'
  if (file.type === 'application/pdf') return 'pdf'
  return null
}

export function uploadPath(format: UploadFileFormat): string {
  return UPLOAD_PATHS[format]
}

export const UNSUPPORTED_FILE_MESSAGE =
  '取込できるのは CSV(.csv)と明細 PDF(.pdf)です。別のファイルを選び直してください。'

/** `%PDF` シグネチャ不一致（API が `reason: 'not_a_pdf'` 付きの 400 で返す）に対する画面文言 */
export const NOT_A_PDF_MESSAGE =
  'PDF として読み取れないファイルです。カード会社・銀行のサイトで保存した PDF を選び直してください。'

export type UploadFileCheck =
  | { ok: true; format: UploadFileFormat }
  | { ok: false; message: string }

/** 選択されたファイルを送ってよいか。拒否する場合は利用者向けの理由を返す */
export function checkUploadFile(file: File): UploadFileCheck {
  const format = detectUploadFormat(file)
  if (format === null) return { ok: false, message: UNSUPPORTED_FILE_MESSAGE }
  if (file.size > MAX_UPLOAD_BYTES[format]) {
    return {
      ok: false,
      message: `${format.toUpperCase()} は ${SIZE_LIMIT_LABELS[format]} 以下にしてください。対象月を絞ってダウンロードし直すと小さくなります。`,
    }
  }
  return { ok: true, format }
}

const PDF_CONVERSION_MESSAGES: Record<PdfConversionFailureReason, string> = {
  api_call_failed:
    'PDF の変換サービスに繋がりませんでした。しばらくおいてからもう一度アップロードしてください。',
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
 * PDF 変換失敗の理由が未知（サーバー先行デプロイで値が増えた場合）のときだけ、
 * 握りつぶさずに失敗詳細をそのまま添える。
 */
export function describeImportFailure(failure: ImportJobFailureWire): string {
  switch (failure.kind) {
    case 'pdf_conversion_failed': {
      const reason = PdfConversionFailureReasonSchema.safeParse(failure.reason)
      return reason.success
        ? PDF_CONVERSION_MESSAGES[reason.data]
        : `PDF の変換に失敗しました（${failure.failureDetail}）。しばらくおいてからもう一度お試しください。`
    }
    case 'format_validation_failed':
      // 失敗詳細は「3 行目: 金額が不正である: abc」のように直し方が分かる形で返る
      return `CSV の形式を確認できませんでした（${failure.failureDetail}）。カード会社・銀行のサイトからダウンロードした CSV をそのままアップロードしてください。`
    case 'import_error':
      // 内部例外のメッセージ（DB エラー等）は利用者に出さない。詳細はサーバーログで追う
      return '取込の途中でエラーが発生しました。しばらくおいてからもう一度アップロードしてください。'
  }
}

export interface UploadErrorInput {
  /** 送信前に拒否した場合の文言（他のどのエラーより優先する） */
  selectionError: string | null
  /** アップロード要求の失敗。成功していれば null */
  error: { status?: number; message: string; reason?: string } | null
  /** 失敗ジョブが返っている場合は取込ジョブカード側で理由を出すため、ここでは出さない */
  hasJob: boolean
}

/**
 * アップロード要求の失敗を画面文言にする（ジョブが返らなかったケース）。
 * 表示不要なら null。
 */
export function describeUploadError({
  selectionError,
  error,
  hasJob,
}: UploadErrorInput): string | null {
  if (selectionError !== null) return selectionError
  if (error === null || hasJob) return null
  if (error.reason === 'not_a_pdf') return NOT_A_PDF_MESSAGE
  if (error.status === 400) {
    return 'アップロードを受け付けられませんでした。ファイルを確認して、もう一度お試しください。'
  }
  return `アップロードに失敗しました（${error.message}）。通信状況を確認して、もう一度お試しください。`
}
