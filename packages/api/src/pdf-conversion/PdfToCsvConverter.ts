/**
 * PDF→CSV 変換ポート（取引取込コンテキストの ACL 翻訳層、OQ-23）
 * @see docs/domain/08a-ul-取引取込.md §2「PDFをCSVに変換する」
 *
 * behavior PDFをCSVに変換する = 明細PDF -> 変換成功 OR 変換失敗
 * 変換の検証（行数一致 + 合計金額一致）は実装側の責務。
 * 失敗理由はドメインの `PdfConversionFailureReason` に翻訳して返す。
 */
import type { PdfConversionFailureReason } from '@warimaru/domain'

/** 変換で抽出された明細 1 行（取引候補の生成材料） */
export interface ConvertedStatementRow {
  /** ご利用日（JST 暦日を UTC 深夜 0 時の Date で表現、parse-statement-csv と同じ規約） */
  occurredAt: Date
  /** ご利用店名（NFKC 正規化 + 空白圧縮 + 長音統一 適用済み、OQ-23） */
  merchantName: string
  /** ご利用金額（円、整数。返金はマイナス） */
  amount: number
  /** 明細が記載されていた PDF ページ番号（1 始まり） */
  pageNumber: number
}

export type PdfToCsvConversion =
  | { ok: true; rows: ConvertedStatementRow[] }
  | { ok: false; reason: PdfConversionFailureReason; failureDetail: string }

export interface PdfToCsvConverter {
  convert(pdf: Uint8Array): Promise<PdfToCsvConversion>
}
