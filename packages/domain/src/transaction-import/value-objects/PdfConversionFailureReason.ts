/**
 * PDF→CSV 変換の失敗理由（PDF → CSV 変換、Anthropic API 利用は adapter 層関心）
 * @see docs/domain/08a-ul-取引取込.md §2「PDFをCSVに変換する」
 *
 * 変換の検証は行数一致 + 合計金額一致で行う（OQ-23）。
 * 検証失敗はそれぞれ row_count_mismatch / total_amount_mismatch として区別する。
 *
 * 変換成功時は生成 CSV を永続化せず、抽出した明細行（`ConvertedStatementRow`）を
 * 直接取引候補の生成材料とする（PR #55）。このため成功結果を包む値オブジェクトは持たず、
 * 変換の成否は driven port `PdfToCsvConverter` の `PdfToCsvConversion` で表現する
 * （PDF 変換ジョブ ID・変換完了日時は `StatementImportJob` 集約が保持する）。
 */
import { z } from 'zod'

export const PdfConversionFailureReasonSchema = z.enum([
  'api_call_failed',
  'invalid_response_structure',
  'row_count_mismatch',
  'total_amount_mismatch',
  'timeout',
])
export type PdfConversionFailureReason = z.infer<typeof PdfConversionFailureReasonSchema>
