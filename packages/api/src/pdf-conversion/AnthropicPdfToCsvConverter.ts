/**
 * PdfToCsvConverter の Anthropic API 実装（OQ-23）
 *
 * 三井住友カード利用明細 PDF を Claude の document 入力（base64）で読み取り、
 * 構造化出力（output_config.format）で明細行を抽出する。
 * OQ-23 の実装方針に従い、検証は「行数一致 + 利用金額合計一致」で構造一致を確認する。
 *
 * 失敗理由の翻訳（ドメイン `PdfConversionFailureReason` へ）:
 *  - timeout: API 呼び出しのタイムアウト
 *  - api_call_failed: 上記以外の API エラー（認証・接続・refusal 含む）
 *  - invalid_response_structure: 構造化出力の欠落・スキーマ不一致・日付等の値不正・max_tokens 途中終了
 *  - row_count_mismatch / total_amount_mismatch: OQ-23 構造一致検証（行数一致・利用金額合計一致）
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
// SDK の zodOutputFormat は zod v4 スキーマを要求する（zod 3.25+ が同梱する v4 API を使用。
// このファイル内に閉じた利用で、ドメイン層の zod v3 スキーマとは独立）
import { z } from 'zod/v4'
import { normalizeMerchantName, type PdfConversionFailureReason } from '@warimaru/domain'
import type {
  ConvertedStatementRow,
  PdfToCsvConversion,
  PdfToCsvConverter,
} from './PdfToCsvConverter.js'

/** 構造化出力スキーマ（数値制約・日付形式の検証は API 側で未サポートのためローカルで行う） */
const ConversionOutputSchema = z.object({
  rows: z.array(
    z.object({
      date: z.string().describe('ご利用日（YYYY-MM-DD）'),
      merchantName: z.string().describe('ご利用店名（空白・長音記号・大文字小文字を原文のまま）'),
      amount: z.number().int().describe('ご利用金額（円の整数、カンマなし。返金はマイナス）'),
      pageNumber: z
        .number()
        .int()
        .describe('この明細行が記載されている PDF ページ番号（1 始まり）'),
    }),
  ),
  statedRowCount: z.number().int().describe('PDF 上の明細行を rows とは独立に数えた総数'),
  statedTotalAmount: z.number().int().describe('PDF に記載されているご利用金額の合計（円）'),
})

const PROMPT = [
  '三井住友カードの利用明細 PDF から、すべての利用明細行を抽出してください。',
  '',
  '- 明細表は 1 行 = 1 利用で、ご利用日・ご利用店名・ご利用金額を含む 13 列構造です',
  '- ご利用店名は表記を忠実に抽出してください（空白・長音記号・大文字小文字をそのまま）',
  '- ご利用金額は円の整数（カンマなし）。返金・調整のマイナスはそのまま負数にしてください',
  '- 合計行・繰越行・注記など、利用明細以外の行は rows に含めないでください',
  '- statedRowCount には PDF 上の明細行を rows とは独立に数え直した総数を設定してください',
  '- statedTotalAmount には PDF に記載されているご利用金額の合計（円）を設定してください',
].join('\n')

const DATE_REGEX = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/

/** JST 暦日文字列 → UTC 深夜 0 時の Date（parse-statement-csv と同じ規約）。不正は null */
function parseCalendarDate(raw: string): Date | null {
  const m = DATE_REGEX.exec(raw.trim())
  if (m === null) return null
  const [, y, mo, d] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return date
}

/** テスト差し替え用の最小クライアント I/F（実クライアントと構造的に互換） */
export interface StructuredOutputClient {
  messages: {
    parse(
      params: Anthropic.MessageCreateParamsNonStreaming,
      options?: { timeout?: number },
    ): Promise<{ parsed_output?: unknown; stop_reason: string | null }>
  }
}

export interface AnthropicPdfToCsvConverterOptions {
  /** 省略時は初回変換時に `new Anthropic()`（ANTHROPIC_API_KEY 等を環境から解決） */
  client?: StructuredOutputClient
  /** 省略時は claude-opus-4-8（OQ-23 は Opus 系で検証済み） */
  model?: string
  /** API 呼び出しタイムアウト（ミリ秒）。省略時 5 分 */
  timeoutMs?: number
}

export class AnthropicPdfToCsvConverter implements PdfToCsvConverter {
  private client: StructuredOutputClient | undefined
  private readonly model: string
  private readonly timeoutMs: number

  constructor(options: AnthropicPdfToCsvConverterOptions = {}) {
    this.client = options.client
    this.model = options.model ?? 'claude-opus-4-8'
    this.timeoutMs = options.timeoutMs ?? 300_000
  }

  async convert(pdf: Uint8Array): Promise<PdfToCsvConversion> {
    let response: { parsed_output?: unknown; stop_reason: string | null }
    try {
      // クライアント生成もここで行う（API キー未設定はコンストラクタでなく変換失敗として返す）
      this.client ??= new Anthropic()
      response = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: 16000,
          thinking: { type: 'adaptive' },
          output_config: { format: zodOutputFormat(ConversionOutputSchema) },
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: Buffer.from(pdf).toString('base64'),
                  },
                },
                { type: 'text', text: PROMPT },
              ],
            },
          ],
        },
        { timeout: this.timeoutMs },
      )
    } catch (e) {
      if (e instanceof Anthropic.APIConnectionTimeoutError) {
        return failure('timeout', `API 呼び出しがタイムアウトした（${this.timeoutMs}ms）`)
      }
      return failure('api_call_failed', e instanceof Error ? e.message : String(e))
    }

    if (response.stop_reason === 'refusal') {
      return failure('api_call_failed', 'API が応答を拒否した（stop_reason: refusal）')
    }
    if (response.stop_reason === 'max_tokens') {
      return failure('invalid_response_structure', '出力が max_tokens で途中終了した')
    }

    const parsed = ConversionOutputSchema.safeParse(response.parsed_output)
    if (!parsed.success) {
      return failure(
        'invalid_response_structure',
        `構造化出力を解釈できない: ${parsed.error.message}`,
      )
    }
    const { rows, statedRowCount, statedTotalAmount } = parsed.data

    // OQ-23: 行数一致 + 利用金額合計一致で構造一致を確認する
    if (rows.length !== statedRowCount) {
      return failure(
        'row_count_mismatch',
        `明細行数が一致しない（抽出 ${rows.length} 行 / 記載 ${statedRowCount} 行）`,
      )
    }
    const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0)
    if (totalAmount !== statedTotalAmount) {
      return failure(
        'total_amount_mismatch',
        `利用金額合計が一致しない（抽出合計 ${totalAmount} 円 / 記載 ${statedTotalAmount} 円）`,
      )
    }

    const converted: ConvertedStatementRow[] = []
    for (const [index, row] of rows.entries()) {
      const occurredAt = parseCalendarDate(row.date)
      if (occurredAt === null) {
        return failure(
          'invalid_response_structure',
          `${index + 1} 行目: ご利用日が不正: ${row.date}`,
        )
      }
      if (row.pageNumber < 1) {
        return failure(
          'invalid_response_structure',
          `${index + 1} 行目: ページ番号が不正: ${row.pageNumber}`,
        )
      }
      const merchantName = normalizeMerchantName(row.merchantName)
      if (merchantName.length === 0) {
        return failure('invalid_response_structure', `${index + 1} 行目: ご利用店名が空である`)
      }
      converted.push({ occurredAt, merchantName, amount: row.amount, pageNumber: row.pageNumber })
    }
    return { ok: true, rows: converted }
  }
}

function failure(reason: PdfConversionFailureReason, failureDetail: string): PdfToCsvConversion {
  return { ok: false, reason, failureDetail }
}
