import { describe, it, expect } from 'vitest'
import type { MonthlyReport } from '@warimaru/domain'
import { CategoryIdSchema, MonthlyReportSchema, YearMonthSchema, money } from '@warimaru/domain'
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
    // 対象月が端から端まで伝わることを固定するため、期待値はリテラルで書く
    expect(content.textBody).toContain(
      'https://www.smbc-card.com/memx/web_meisai/top/index.html?p01=202607',
    )
    expect(content.textBody).toContain('https://direct3.smbc.co.jp/sp/web/')
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

  it('カテゴリが 1 件も無い月は合計 0 円だけを出す', () => {
    const empty = buildHouseholdSummaryContent(
      report({ householdCategoryTotals: [] }),
      nameOf,
      links,
    )
    if (empty.kind !== 'flex_message') throw new Error('unreachable')
    const emptyTexts = flexTexts(empty.flexPayloadJson)
    expect(emptyTexts).toContain('0円')
    expect(emptyTexts.filter(t => t.startsWith('・'))).toHaveLength(0)
  })

  it('返金過多などで負の合計になる月もそのまま表示する', () => {
    const negative = buildHouseholdSummaryContent(
      report({
        householdCategoryTotals: [
          { categoryId: CategoryIdSchema.parse(CATEGORY_FOOD), total: money(-5000) },
        ],
      }),
      nameOf,
      links,
    )
    if (negative.kind !== 'flex_message') throw new Error('unreachable')
    expect(flexTexts(negative.flexPayloadJson)).toContain('-5,000円')
  })

  it('カテゴリが多い月は上位 12 件までを個別表示し、残りは 1 行に合算する', () => {
    // 上限が無いと Flex payload が LINE のサイズ上限を超え、その月のサマリが失われる
    const many = Array.from({ length: 15 }, (_, i) => ({
      categoryId: CategoryIdSchema.parse(ulid(`CAT${String(i).padStart(2, '0')}`)),
      total: money((i + 1) * 1000),
    }))
    const content = buildHouseholdSummaryContent(
      report({ householdCategoryTotals: many }),
      () => undefined,
      links,
    )
    if (content.kind !== 'flex_message') throw new Error('unreachable')
    const texts = flexTexts(content.flexPayloadJson)
    const rows = texts.filter(t => t.startsWith('・'))
    expect(rows).toHaveLength(13) // 個別 12 行 + 合算 1 行
    expect(rows.at(-1)).toBe('・ほか 3 件')
    // 合算されるのは金額の小さい 3 件（1000 + 2000 + 3000）
    expect(texts).toContain('6,000円')
  })

  it('長すぎるカテゴリ名は切り詰める', () => {
    const longName = 'あ'.repeat(50)
    const content = buildHouseholdSummaryContent(report(), () => longName, links)
    if (content.kind !== 'flex_message') throw new Error('unreachable')
    const label = flexTexts(content.flexPayloadJson).find(t => t.startsWith('・')) ?? ''
    expect(label.length).toBeLessThanOrEqual(25) // 先頭の「・」+ 24 文字
    expect(label.endsWith('…')).toBe(true)
  })

  it('名前を解決できないカテゴリは ID を露出させず「その他」に丸める', () => {
    const unresolved = buildHouseholdSummaryContent(report(), () => undefined, links)
    if (unresolved.kind !== 'flex_message') throw new Error('unreachable')
    expect(unresolved.flexPayloadJson).not.toContain(CATEGORY_FOOD)
    expect(flexTexts(unresolved.flexPayloadJson)).toContain('・その他')
  })

  it('不完全月は金額より前に注意書きを出す（#442-A。レポート画面と同じ注意）', () => {
    const incomplete = buildHouseholdSummaryContent(
      report({ isIncompleteMonth: true }),
      nameOf,
      links,
    )
    if (incomplete.kind !== 'flex_message') throw new Error('unreachable')
    const incompleteTexts = flexTexts(incomplete.flexPayloadJson)
    const notice = incompleteTexts.find(t => t.includes('データが不完全な月です'))
    expect(notice).toBeDefined()
    // 金額を読む前に目に入る位置に置く（読んだ後に気づいても確定値としての誤読は防げない）
    expect(incompleteTexts.indexOf(notice as string)).toBeLessThan(
      incompleteTexts.indexOf('世帯費用 合計'),
    )
  })

  it('通常の月には注意書きを出さない', () => {
    // フラグの無い月にも出すと、注意書きが常時表示になって意味を失う
    expect(texts.some(t => t.includes('データが不完全な月です'))).toBe(false)
    expect(texts).toContain('世帯費用 合計')
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

  it('不完全月は個人サマリにも金額より前に注意書きを出す（世帯サマリと同じ条件）', () => {
    const content = buildPersonalSummaryContent(report({ isIncompleteMonth: true }), 'honey', links)
    if (content.kind !== 'flex_message') throw new Error('unreachable')
    const texts = flexTexts(content.flexPayloadJson)
    const notice = texts.find(t => t.includes('データが不完全な月です'))
    expect(notice).toBeDefined()
    expect(texts.indexOf(notice as string)).toBeLessThan(texts.indexOf('個人費用 合計'))
  })

  it('通常の月には個人サマリにも注意書きを出さない', () => {
    const content = buildPersonalSummaryContent(report(), 'honey', links)
    if (content.kind !== 'flex_message') throw new Error('unreachable')
    expect(flexTexts(content.flexPayloadJson).some(t => t.includes('データが不完全な月です'))).toBe(
      false,
    )
  })
})
