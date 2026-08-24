import { describe, it, expect } from 'vitest'
import {
  statementSiteMonthSupported,
  statementSiteUrl,
} from '../../../src/transaction-import/value-objects/StatementSiteUrl'
import { StatementFileKindSchema } from '../../../src/transaction-import/aggregates/StatementImportJob'
import { YearMonthSchema } from '../../../src/shared/value-objects/YearMonth'

const month = (value: string) => YearMonthSchema.parse(value)

const CARD_URL_JULY = 'https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202607'
const BANK_URL = 'https://direct3.smbc.co.jp/sp/web/'

describe('statementSiteUrl（#472: 明細取得元サイトURL の単一実装）', () => {
  it('カード明細は対象月を p01=YYYYMM で付けた三井住友カードの明細ページを返す', () => {
    expect(statementSiteUrl('card_statement', month('2026-07'))).toBe(CARD_URL_JULY)
  })

  it('カード明細は月ごとに開く先が変わる（1 月・12 月の桁揃えを含む）', () => {
    expect(statementSiteUrl('card_statement', month('2026-01'))).toBe(
      'https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202601',
    )
    expect(statementSiteUrl('card_statement', month('2026-12'))).toBe(
      'https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202612',
    )
  })

  it('銀行明細は月を指定できない（OQ-38）ため、どの月でも同じ入口の URL を返す', () => {
    expect(statementSiteUrl('bank_statement', month('2026-01'))).toBe(BANK_URL)
    expect(statementSiteUrl('bank_statement', month('2026-07'))).toBe(BANK_URL)
    expect(statementSiteUrl('bank_statement', month('2026-12'))).toBe(BANK_URL)
  })

  it('銀行明細の URL には月パラメータを埋め込まない', () => {
    expect(statementSiteUrl('bank_statement', month('2026-07'))).not.toContain('202607')
    expect(statementSiteUrl('bank_statement', month('2026-07'))).not.toContain('?')
  })

  it('種別が増えても既存種別の URL に落ちない（すべての種別が別々の取得元を持つ）', () => {
    const urls = StatementFileKindSchema.options.map(kind =>
      statementSiteUrl(kind, month('2026-07')),
    )
    expect(new Set(urls).size).toBe(StatementFileKindSchema.options.length)
  })
})

describe('statementSiteMonthSupported（明細取得元月指定可否）', () => {
  it('カード明細は URL で対象月を指定できる', () => {
    expect(statementSiteMonthSupported('card_statement')).toBe(true)
  })

  it('銀行明細は URL で対象月を指定できない（OQ-38）', () => {
    expect(statementSiteMonthSupported('bank_statement')).toBe(false)
  })

  it('月を指定できる種別だけが、月ごとに違う URL を返す', () => {
    for (const kind of StatementFileKindSchema.options) {
      const january = statementSiteUrl(kind, month('2026-01'))
      const december = statementSiteUrl(kind, month('2026-12'))
      expect(january !== december).toBe(statementSiteMonthSupported(kind))
    }
  })
})
