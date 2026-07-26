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

  it('Gmail 再認可は OQ-54 の契約どおり /settings?section=oauth を生成する', () => {
    expect(links.gmailReauthorization()).toBe(
      'https://liff.line.me/1234567890-abcdefgh/settings?section=oauth',
    )
  })

  it('OQ-54 ③ で作らないと決めたビュー切替（view=）を付けない', () => {
    expect(links.monthlyReport(month)).not.toContain('view=')
  })

  it('base の末尾スラッシュがあってもパスが二重スラッシュにならない', () => {
    const withSlash = createDeepLinkBuilder('https://example.com/app/')
    expect(withSlash.monthlyReport(month)).toBe('https://example.com/app/reports?month=2026-07')
  })

  it('三井住友カードの明細 URL に対象月を YYYYMM で埋め込む', () => {
    expect(links.smbcCardStatement(month)).toBe(
      'https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202607',
    )
  })

  it('三井住友銀行の明細 URL には月を埋め込まない（OQ-38: 月をクエリ指定できない）', () => {
    expect(links.smbcBankStatement()).toBe('https://direct3.smbc.co.jp/sp/web/')
    expect(links.smbcBankStatement()).not.toContain('2026')
  })
})
