import { describe, it, expect } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import {
  AnthropicPdfToCsvConverter,
  type StructuredOutputClient,
} from '../../src/pdf-conversion/AnthropicPdfToCsvConverter.js'

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]) // "%PDF"

function clientReturning(parsedOutput: unknown, stopReason = 'end_turn'): StructuredOutputClient {
  return {
    messages: {
      async parse() {
        return { parsed_output: parsedOutput, stop_reason: stopReason }
      },
    },
  }
}

function clientThrowing(error: Error): StructuredOutputClient {
  return {
    messages: {
      async parse() {
        throw error
      },
    },
  }
}

const VALID_OUTPUT = {
  rows: [
    { date: '2026-06-05', merchantName: 'ｽｰﾊﾟｰ  A', amount: 1200, pageNumber: 1 },
    { date: '2026/06/07', merchantName: 'コ-ヒ-ショップ', amount: -300, pageNumber: 2 },
  ],
  statedRowCount: 2,
  statedTotalAmount: 900,
}

describe('AnthropicPdfToCsvConverter', () => {
  it('変換成功: 日付を JST 暦日 Date に変換し、加盟店名を正規化して返す', async () => {
    const converter = new AnthropicPdfToCsvConverter({ client: clientReturning(VALID_OUTPUT) })
    const result = await converter.convert(PDF_BYTES)
    if (!result.ok) throw new Error(`成功を期待したが失敗: ${result.failureDetail}`)
    expect(result.rows).toEqual([
      {
        occurredAt: new Date(Date.UTC(2026, 5, 5)),
        merchantName: 'スーパー A',
        amount: 1200,
        pageNumber: 1,
      },
      {
        occurredAt: new Date(Date.UTC(2026, 5, 7)),
        merchantName: 'コーヒーショップ',
        amount: -300,
        pageNumber: 2,
      },
    ])
  })

  it('行数不一致は row_count_mismatch（OQ-23 構造一致検証）', async () => {
    const converter = new AnthropicPdfToCsvConverter({
      client: clientReturning({ ...VALID_OUTPUT, statedRowCount: 3 }),
    })
    const result = await converter.convert(PDF_BYTES)
    if (result.ok) throw new Error('失敗を期待した')
    expect(result.reason).toBe('row_count_mismatch')
    expect(result.failureDetail).toContain('明細行数')
  })

  it('利用金額合計の不一致は total_amount_mismatch（OQ-23 構造一致検証）', async () => {
    const converter = new AnthropicPdfToCsvConverter({
      client: clientReturning({ ...VALID_OUTPUT, statedTotalAmount: 1000 }),
    })
    const result = await converter.convert(PDF_BYTES)
    if (result.ok) throw new Error('失敗を期待した')
    expect(result.reason).toBe('total_amount_mismatch')
    expect(result.failureDetail).toContain('利用金額合計')
  })

  it('構造化出力の欠落・スキーマ不一致は invalid_response_structure', async () => {
    for (const parsedOutput of [null, undefined, { rows: 'broken' }]) {
      const converter = new AnthropicPdfToCsvConverter({ client: clientReturning(parsedOutput) })
      const result = await converter.convert(PDF_BYTES)
      if (result.ok) throw new Error('失敗を期待した')
      expect(result.reason).toBe('invalid_response_structure')
    }
  })

  it('日付が不正な行は invalid_response_structure', async () => {
    const converter = new AnthropicPdfToCsvConverter({
      client: clientReturning({
        rows: [{ date: '2026-02-30', merchantName: 'スーパーA', amount: 100, pageNumber: 1 }],
        statedRowCount: 1,
        statedTotalAmount: 100,
      }),
    })
    const result = await converter.convert(PDF_BYTES)
    if (result.ok) throw new Error('失敗を期待した')
    expect(result.reason).toBe('invalid_response_structure')
    expect(result.failureDetail).toContain('ご利用日')
  })

  it('max_tokens 途中終了は invalid_response_structure', async () => {
    const converter = new AnthropicPdfToCsvConverter({
      client: clientReturning(VALID_OUTPUT, 'max_tokens'),
    })
    const result = await converter.convert(PDF_BYTES)
    if (result.ok) throw new Error('失敗を期待した')
    expect(result.reason).toBe('invalid_response_structure')
  })

  it('タイムアウトは timeout に翻訳される', async () => {
    const converter = new AnthropicPdfToCsvConverter({
      client: clientThrowing(new Anthropic.APIConnectionTimeoutError()),
    })
    const result = await converter.convert(PDF_BYTES)
    if (result.ok) throw new Error('失敗を期待した')
    expect(result.reason).toBe('timeout')
  })

  it('その他の API エラーは api_call_failed に翻訳される', async () => {
    const converter = new AnthropicPdfToCsvConverter({
      client: clientThrowing(new Anthropic.APIConnectionError({ message: '接続失敗' })),
    })
    const result = await converter.convert(PDF_BYTES)
    if (result.ok) throw new Error('失敗を期待した')
    expect(result.reason).toBe('api_call_failed')
    expect(result.failureDetail).toContain('接続失敗')
  })

  it('pause_turn は api_call_failed に翻訳される（サーバーサイドツール未使用のため通常発生しない）', async () => {
    const converter = new AnthropicPdfToCsvConverter({
      client: clientReturning(VALID_OUTPUT, 'pause_turn'),
    })
    const result = await converter.convert(PDF_BYTES)
    if (result.ok) throw new Error('失敗を期待した')
    expect(result.reason).toBe('api_call_failed')
    expect(result.failureDetail).toContain('pause_turn')
  })

  it('refusal は api_call_failed に翻訳される', async () => {
    const converter = new AnthropicPdfToCsvConverter({
      client: clientReturning(VALID_OUTPUT, 'refusal'),
    })
    const result = await converter.convert(PDF_BYTES)
    if (result.ok) throw new Error('失敗を期待した')
    expect(result.reason).toBe('api_call_failed')
  })
})
