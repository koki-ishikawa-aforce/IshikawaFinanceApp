'use client'

import { useId, useState } from 'react'
import type { StatementFileKind, YearMonth } from '@warimaru/domain'
import { LuChevronDown, LuExternalLink } from '@/components/ui/icons'
import { openExternal } from '@/lib/liff'
import { formatMonthLabel } from '@/lib/month'
import { statementSiteUrl } from '@/lib/statement-links'
import ui from '@/components/ui/common.module.css'
import styles from './StatementGuide.module.css'

const CARD_STEPS = [
  '「明細を確認する」を開いてログインする',
  '対象月の利用明細を表示する',
  '「ご利用明細データダウンロード」から CSV を保存する',
] as const

const BANK_STEPS = [
  'SMBC ダイレクトにログインする',
  '一番上の「口座」カード（緑）をタップする',
  '明細画面で対象月まで「さらに 3 ヵ月表示」を押す',
  '「明細を CSV ダウンロード」から CSV を保存する',
] as const

interface SourceGuide {
  readonly title: string
  readonly steps: readonly string[]
  readonly linkLabel: string
  readonly note: (month: YearMonth) => string
}

const GUIDES: Record<StatementFileKind, SourceGuide> = {
  card_statement: {
    title: '三井住友カード（カード利用明細）',
    steps: CARD_STEPS,
    linkLabel: '三井住友カードの明細ページを開く',
    note: month => `${formatMonthLabel(month)}分の明細ページが開きます。`,
  },
  bank_statement: {
    title: '三井住友銀行（銀行入出金明細）',
    steps: BANK_STEPS,
    linkLabel: 'SMBC ダイレクトを開く',
    // 月を指定して開けない制約は、手順の前に伝えないと「開いたのに違う月」に見える。
    note: month =>
      `月を指定して開くことはできません。ログイン後に${formatMonthLabel(month)}を表示してからダウンロードしてください。`,
  },
}

interface StatementGuideProps {
  fileKind: StatementFileKind
  month: YearMonth
}

/**
 * 明細 CSV の取得手順ガイド（spec §10.2、§10.1 ③「アップロード対象カード」1 枚ぶん）。
 *
 * リンクは `openExternal` 経由で OS 標準ブラウザに開く。LIFF 内ブラウザでは
 * 銀行・カードのログインが安定しないため（同 §10.2）。LIFF 外で開いた場合は
 * `openExternal` が `window.open` にフォールバックするので、ここでは分岐しない。
 */
export function StatementGuide({ fileKind, month }: StatementGuideProps) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()
  const guide = GUIDES[fileKind]

  return (
    <div className={ui.card}>
      {/* 見出しでボタンを包む（ディスクロージャの慣用形。見出しジャンプで 2 枚を区別できる） */}
      <h2 className={ui.sectionTitle}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(prev => !prev)}
        >
          {guide.title}の取得方法
          <LuChevronDown
            aria-hidden="true"
            className={expanded ? styles.chevronOpen : styles.chevron}
          />
        </button>
      </h2>
      <div id={bodyId} hidden={!expanded} className={styles.body}>
        {/* 月送りでページ遷移なしに差し替わる。読み上げにも変化を届ける（usability §8-4） */}
        <p className={styles.note} role="status">
          {guide.note(month)}
        </p>
        <ol className={styles.steps}>
          {guide.steps.map(step => (
            <li key={step} className={styles.step}>
              {step}
            </li>
          ))}
        </ol>
        <button
          type="button"
          className={`${ui.buttonGhost} ${ui.iconLabel}`}
          onClick={() => openExternal(statementSiteUrl(fileKind, month))}
        >
          {guide.linkLabel}
          <LuExternalLink aria-hidden="true" className={styles.linkIcon} />
        </button>
        <p className={styles.note}>
          ブラウザで CSV を保存したあと、この画面に戻ってアップロードしてください。
        </p>
      </div>
    </div>
  )
}
