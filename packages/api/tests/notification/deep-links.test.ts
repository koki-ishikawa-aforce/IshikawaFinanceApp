import { describe, it, expect } from 'vitest'
import { YearMonthSchema } from '@warimaru/domain'
import { createDeepLinkBuilder } from '../../src/notification/deep-links.js'

const month = YearMonthSchema.parse('2026-07')

describe('createDeepLinkBuilder', () => {
  const links = createDeepLinkBuilder('https://liff.line.me/1234567890-abcdefgh')

  it('月次レポートは OQ-54 の契約どおり /reports?month=YYYY-MM を生成する', () => {
    expect(links.monthlyReport(month)).toBe(
      'https://liff.line.me/1234567890-abcdefgh/reports?month=2026-07',
    )
  })

  it('CSV 取込は OQ-54 の契約どおり /imports?month=YYYY-MM を生成する', () => {
    expect(links.csvImport(month)).toBe(
      'https://liff.line.me/1234567890-abcdefgh/imports?month=2026-07',
    )
  })

  it('OQ-54 ③ で作らないと決めたビュー切替（view=）を付けない', () => {
    expect(links.monthlyReport(month)).not.toContain('view=')
  })

  it('base の末尾スラッシュがあってもパスが二重スラッシュにならない', () => {
    const withSlash = createDeepLinkBuilder('https://example.com/app/')
    expect(withSlash.monthlyReport(month)).toBe('https://example.com/app/reports?month=2026-07')
  })

  it('明細の取得元サイト URL は持たない（#472: ドメインの statementSiteUrl が単一実装）', () => {
    expect(links).not.toHaveProperty('smbcCardStatement')
    expect(links).not.toHaveProperty('smbcBankStatement')
    expect(JSON.stringify(Object.values(links).map(build => build(month)))).not.toContain(
      'smbc-card.com',
    )
  })
})
