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

  it('Gmail 再認可は論点57 ④ の契約どおり /settings?section=oauth&provider=gmail を生成する', () => {
    expect(links.gmailReauthorization()).toBe(
      'https://liff.line.me/1234567890-abcdefgh/settings?section=oauth&provider=gmail',
    )
  })

  it('base の末尾スラッシュがあってもパスが二重スラッシュにならない', () => {
    const withSlash = createDeepLinkBuilder('https://example.com/app/')
    expect(withSlash.monthlyReport(month)).toBe('https://example.com/app/reports?month=2026-07')
  })

  it('明細の取得元サイト URL は持たない（#472: ドメインの statementSiteUrl が単一実装）', () => {
    expect(links).not.toHaveProperty('smbcCardStatement')
    expect(links).not.toHaveProperty('smbcBankStatement')
    const all = [links.monthlyReport(month), links.csvImport(month), links.gmailReauthorization()]
    // ビルダーを追加したら all にも足すこと（漏れをここで検出する）
    expect(Object.keys(links)).toHaveLength(all.length)
    expect(JSON.stringify(all)).not.toContain('smbc-card.com')
  })
})
