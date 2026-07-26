import { describe, it, expect } from 'vitest'
import type { MonthlyReport } from '@warimaru/domain'
import { MonthlyReportSchema, YearMonthSchema } from '@warimaru/domain'
import { createDeepLinkBuilder } from '../../src/notification/deep-links.js'
import {
  buildCsvImportReminderContent,
  buildHouseholdSummaryContent,
  buildPersonalSummaryContent,
} from '../../src/notification/message-content.js'

const links = createDeepLinkBuilder('https://liff.example/app')
const month = YearMonthSchema.parse('2026-07')

/** テスト用の ULID（26 文字・先頭 0-7・Crockford Base32） */
const ulid = (suffix: string): string => `01HZ${suffix}`.padEnd(26, '0')
const REPORT_ID = ulid('RPRT')
const CATEGORY_FOOD = ulid('CATF')
const CATEGORY_HOUSING = ulid('CATH')

function report(overrides: Partial<MonthlyReport['common']> = {}): MonthlyReport {
  return MonthlyReportSchema.parse({
    kind: 'csv_confirmed',
    common: {
      monthlyReportId: REPORT_ID,
      targetYearMonth: month,
      householdCategoryTotals: [
        { categoryId: CATEGORY_FOOD, total: 82000 },
        { categoryId: CATEGORY_HOUSING, total: 145000 },
      ],
      personalTotalHoney: 31000,
      personalTotalDarling: 27500,
      businessExpenseTotalHoney: 12000,
      businessExpenseTotalDarling: 4500,
      nisaContributionAccumulated: 600000,
      balanceTrend: {
        smbcBalanceTrend: [
          { date: new Date('2026-06-30T00:00:00Z'), balance: 900000 },
          { date: new Date('2026-07-31T00:00:00Z'), balance: 812000 },
        ],
        otherSavingsBalanceTrend: [{ date: new Date('2026-07-31T00:00:00Z'), balance: 1500000 }],
        nisaContributionTrend: [],
        cardUnpaidTrend: [{ date: new Date('2026-07-31T00:00:00Z'), unpaidTotal: 73000 }],
      },
      ...overrides,
    },
    csvConfirmedAt: new Date('2026-08-01T00:00:00Z'),
    causingTransactionIds: [],
  })
}

const categoryNames: Record<string, string> = {
  [CATEGORY_FOOD]: '食費',
  [CATEGORY_HOUSING]: '住居・光熱・通信',
}
const nameOf = (id: string): string | undefined => categoryNames[id]

/**
 * Flex payload 内のすべての text 値を集める。
 * 金額の検査を JSON 文字列の部分一致で行うと "812,000円" が "12,000円" を含むように
 * 別の値へ誤って一致するため、値そのものと突き合わせる。
 */
function flexTexts(flexPayloadJson: string): string[] {
  const texts: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (typeof record['text'] === 'string') texts.push(record['text'])
    Object.values(record).forEach(walk)
  }
  walk(JSON.parse(flexPayloadJson))
  return texts
}

describe('buildCsvImportReminderContent', () => {
  const content = buildCsvImportReminderContent(month, links)

  it('プレーンテキストで対象月を日本語表記で示す', () => {
    expect(content.kind).toBe('plain_text')
    if (content.kind !== 'plain_text') throw new Error('unreachable')
    expect(content.textBody).toContain('2026年7月')
  })

  it('明細のダウンロード元（カード・銀行）の URL を本文に含める（OQ-12）', () => {
    if (content.kind !== 'plain_text') throw new Error('unreachable')
    expect(content.textBody).toContain(links.smbcCardStatement(month))
    expect(content.textBody).toContain(links.smbcBankStatement())
  })

  it('アップロード先はアプリの取込画面の Deep Link を linkUrl に置く', () => {
    if (content.kind !== 'plain_text') throw new Error('unreachable')
    expect(content.linkUrl).toBe('https://liff.example/app/imports?month=2026-07')
  })

  it('linkUrl はゲートウェイが本文末尾へ連結するため、本文中に重複させない', () => {
    if (content.kind !== 'plain_text') throw new Error('unreachable')
    expect(content.textBody).not.toContain(content.linkUrl as string)
  })
})

describe('buildHouseholdSummaryContent', () => {
  const content = buildHouseholdSummaryContent(report(), nameOf, links)
  const payload = content.kind === 'flex_message' ? content.flexPayloadJson : ''
  const texts = flexTexts(payload)

  it('Flex Message として組み立てられ、レポート画面の Deep Link を持つ', () => {
    expect(content.kind).toBe('flex_message')
    if (content.kind !== 'flex_message') throw new Error('unreachable')
    expect(content.linkUrl).toBe('https://liff.example/app/reports?month=2026-07')
    // リンクは payload 内の uri アクションとしても埋め込む（08g の Flex 配信内容の契約）
    expect(payload).toContain('https://liff.example/app/reports?month=2026-07')
  })

  it('世帯費用の合計とカテゴリ別内訳を載せる（OQ-12）', () => {
    expect(texts).toContain('227,000円')
    expect(texts).toContain('・食費')
    expect(texts).toContain('82,000円')
    expect(texts).toContain('・住居・光熱・通信')
    expect(texts).toContain('145,000円')
  })

  it('NISA 積立累計と残高推移の最新値を載せる（OQ-12）', () => {
    expect(texts).toContain('600,000円')
    // smbcBalanceTrend は末尾（最新）の 812,000 を採り、初期値 900,000 は載せない
    expect(texts).toContain('812,000円')
    expect(texts).not.toContain('900,000円')
    expect(texts).toContain('1,500,000円')
    expect(texts).toContain('73,000円')
  })

  it('共通トークルーム宛のため、個人費用・経費(会社)を一切載せない（プライバシー3段階ルール）', () => {
    expect(texts).not.toContain('31,000円')
    expect(texts).not.toContain('27,500円')
    expect(texts).not.toContain('12,000円')
    expect(texts).not.toContain('4,500円')
    expect(texts.some(t => t.includes('経費'))).toBe(false)
  })

  it('残高推移が空の系列は行ごと出さない（0 円と誤読させない）', () => {
    const empty = buildHouseholdSummaryContent(
      report({
        balanceTrend: {
          smbcBalanceTrend: [],
          otherSavingsBalanceTrend: [],
          nisaContributionTrend: [],
          cardUnpaidTrend: [],
        },
      }),
      nameOf,
      links,
    )
    if (empty.kind !== 'flex_message') throw new Error('unreachable')
    const emptyTexts = flexTexts(empty.flexPayloadJson)
    expect(emptyTexts).not.toContain('SMBC 残高')
    expect(emptyTexts).not.toContain('別銀行貯蓄 残高')
    expect(emptyTexts).not.toContain('カード未払金')
  })

  it('名前を解決できないカテゴリは ID を露出させず「その他」に丸める', () => {
    const unresolved = buildHouseholdSummaryContent(report(), () => undefined, links)
    if (unresolved.kind !== 'flex_message') throw new Error('unreachable')
    expect(unresolved.flexPayloadJson).not.toContain(CATEGORY_FOOD)
    expect(flexTexts(unresolved.flexPayloadJson)).toContain('・その他')
  })
})

describe('buildPersonalSummaryContent', () => {
  it('honey 宛には honey の個人費用合計と経費(会社)合計だけを載せる', () => {
    const content = buildPersonalSummaryContent(report(), 'honey', links)
    if (content.kind !== 'flex_message') throw new Error('unreachable')
    const texts = flexTexts(content.flexPayloadJson)
    expect(texts).toContain('31,000円')
    expect(texts).toContain('12,000円')
    // 配偶者（darling）の値は載せない（個人は相手に合計のみ・経費は本人のみ）
    expect(texts).not.toContain('27,500円')
    expect(texts).not.toContain('4,500円')
  })

  it('darling 宛には darling の値だけを載せる', () => {
    const content = buildPersonalSummaryContent(report(), 'darling', links)
    if (content.kind !== 'flex_message') throw new Error('unreachable')
    const texts = flexTexts(content.flexPayloadJson)
    expect(texts).toContain('27,500円')
    expect(texts).toContain('4,500円')
    expect(texts).not.toContain('31,000円')
    expect(texts).not.toContain('12,000円')
  })

  it('世帯費用のカテゴリ内訳は個人 DM に載せない（世帯サマリ側の担当）', () => {
    const content = buildPersonalSummaryContent(report(), 'honey', links)
    if (content.kind !== 'flex_message') throw new Error('unreachable')
    expect(flexTexts(content.flexPayloadJson)).not.toContain('・食費')
  })

  it('レポート画面の Deep Link を持つ', () => {
    const content = buildPersonalSummaryContent(report(), 'honey', links)
    if (content.kind !== 'flex_message') throw new Error('unreachable')
    expect(content.linkUrl).toBe('https://liff.example/app/reports?month=2026-07')
  })
})
