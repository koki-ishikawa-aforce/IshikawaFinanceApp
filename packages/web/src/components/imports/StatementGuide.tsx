'use client'

import { useId, useState } from 'react'
import type { YearMonth } from '@warimaru/domain'
import { LuChevronDown, LuExternalLink } from '@/components/ui/icons'
import { openExternal } from '@/lib/liff'
import { formatMonthLabel } from '@/lib/month'
import ui from '@/components/ui/common.module.css'
import styles from './StatementGuide.module.css'

/**
 * 明細 CSV の取得元。取込画面のファイル種別（card_statement / bank_statement）と対になる。
 * spec §10.2 の「アップロード対象カード」1 枚ぶん。
 */
export type StatementSource = 'card' | 'bank'

/**
 * 三井住友カードの明細ページ。対象月をクエリ `p01` で指定できる（spec §10.2）。
 * 月は YYYYMM 形式（YearMonth の `YYYY-MM` からハイフンを除いたもの）。
 */
const CARD_STATEMENT_URL = 'https://www.smbc-card.com/memx/web_meisai/top/index.html'

/**
 * SMBC ダイレクトの SP サイト入口。明細画面は認証後の遷移先で、
 * URL に月・表示範囲が現れないため月指定はできない（OQ-29 / spec §10.2 改訂）。
 */
const BANK_TOP_URL = 'https://direct3.smbc.co.jp/sp/web/'

export function cardStatementUrl(month: YearMonth): string {
  return `${CARD_STATEMENT_URL}?p01=${month.replace('-', '')}`
}

const CARD_STEPS = [
  '「明細を確認する」を開いてログインする',
  '対象月の利用明細を表示する',
  '「ご利用明細データダウンロード」から CSV を保存する',
] as const

const BANK_STEPS = [
  'SMBC ダイレクトにログインする',
  '口座カード（緑）をタップする',
  '明細画面で対象月まで「さらに 3 ヵ月表示」を押す',
  '「明細を CSV ダウンロード」から CSV を保存する',
] as const

interface SourceGuide {
  readonly title: string
  readonly steps: readonly string[]
  readonly linkLabel: string
  readonly url: (month: YearMonth) => string
  readonly note: (month: YearMonth) => string
}

const GUIDES: Record<StatementSource, SourceGuide> = {
  card: {
    title: '三井住友カード（カード利用明細）',
    steps: CARD_STEPS,
    linkLabel: '三井住友カードの明細ページを開く',
    url: cardStatementUrl,
    note: month => `${formatMonthLabel(month)}分の明細ページが開きます。`,
  },
  bank: {
    title: '三井住友銀行（銀行入出金明細）',
    steps: BANK_STEPS,
    linkLabel: 'SMBC ダイレクトを開く',
    url: () => BANK_TOP_URL,
    // 月を指定して開けない制約は、手順の前に伝えないと「開いたのに違う月」に見える。
    note: month =>
      `月を指定して開くことはできません。ログイン後に${formatMonthLabel(month)}を表示してからダウンロードしてください。`,
  },
}

interface StatementGuideProps {
  source: StatementSource
  month: YearMonth
}

/**
 * 明細 CSV の取得手順ガイド（spec §10.2）。
 *
 * リンクは `openExternal` 経由で OS 標準ブラウザに開く。LIFF 内ブラウザでは
 * 銀行・カードのログインが安定しないため（同 §10.2）。LIFF 外で開いた場合は
 * `openExternal` が `window.open` にフォールバックするので、ここでは分岐しない。
 */
export function StatementGuide({ source, month }: StatementGuideProps) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const guide = GUIDES[source]

  return (
    <div className={ui.card}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className={ui.sectionTitle}>{guide.title}の取得方法</span>
        <LuChevronDown
          aria-hidden="true"
          className={expanded ? styles.chevronOpen : styles.chevron}
        />
      </button>
      <div id={bodyId} hidden={!expanded} className={styles.body}>
        <p className={styles.note}>{guide.note(month)}</p>
        <ol className={styles.steps}>
          {guide.steps.map(step => (
            <li key={step} className={styles.step}>
              {step}
            </li>
          ))}
        </ol>
        <button
          type="button"
          className={ui.buttonGhost}
          onClick={() => openExternal(guide.url(month))}
        >
          <span className={styles.linkLabel}>
            {guide.linkLabel}
            <LuExternalLink aria-hidden="true" className={styles.linkIcon} />
          </span>
        </button>
        <p className={styles.note}>
          ブラウザで CSV を保存したあと、この画面に戻ってアップロードしてください。
        </p>
      </div>
    </div>
  )
}
