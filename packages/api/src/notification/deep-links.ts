/**
 * LINE 通知本文の Deep Link URL 生成（#389 / OQ-54）
 *
 * OQ-54 は「受け側（web の既存ルート + クエリパラメータ）が受理する形を正式契約とし、
 * 送り側がそれに従う」と決めている。本モジュールがその送り側の単一実装で、
 * 契約は次の 3 本に限られる（パス形式の新ルートは Static Export と相性が悪く作らない）:
 *
 *   - 月次レポート: `<base>/reports?month=YYYY-MM`
 *   - CSV 取込:     `<base>/imports?month=YYYY-MM`
 *   - Gmail 再認可: `<base>/settings?section=oauth`
 *
 * レポートのビュー切替（`view=household|personal`）は OQ-54 ③ で「作らない」と決着済みのため、
 * 生成しない（受け側も受理しない）。
 *
 * ドメイン層ではなく api 層に置く理由: URL の形は web のルーティング契約であって
 * 通知配信のドメイン不変条件ではない（08g の `data リンクURL = 文字列` 以上の制約を持たない）。
 */
import type { YearMonth } from '@warimaru/domain'

/** 三井住友カードの明細ダウンロード画面（対象月をクエリで指定できる。spec §10.2） */
const SMBC_CARD_STATEMENT_URL = 'https://www.smbc-card.com/memx/web_meisai/top/index.html'
/**
 * 三井住友銀行（SMBC ダイレクト SP サイト）の入口。
 * 月をクエリで指定する手段が無いことは OQ-38 の実調査で確定済みのため、月は埋め込まない。
 */
const SMBC_BANK_STATEMENT_URL = 'https://direct3.smbc.co.jp/sp/web/'

/** 末尾スラッシュを落として `<base>/<path>` の二重スラッシュを防ぐ */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export interface DeepLinkBuilder {
  /** 月次レポート画面（OQ-54 ①） */
  monthlyReport(month: YearMonth): string
  /** CSV 取込画面（OQ-54 ①） */
  csvImport(month: YearMonth): string
  /** 設定画面の Gmail 連携セクション（OQ-54 ①） */
  gmailReauthorization(): string
  /** 三井住友カードの明細ダウンロード画面（対象月つき） */
  smbcCardStatement(month: YearMonth): string
  /** 三井住友銀行の明細ダウンロード画面（月指定は不可） */
  smbcBankStatement(): string
}

/**
 * アプリの配信元 URL（LIFF の公開 URL）から Deep Link 生成器を作る。
 *
 * @param baseUrl 例: `https://liff.line.me/1234567890-abcdefgh`
 */
export function createDeepLinkBuilder(baseUrl: string): DeepLinkBuilder {
  const base = normalizeBaseUrl(baseUrl)
  return {
    monthlyReport: month => `${base}/reports?month=${month}`,
    csvImport: month => `${base}/imports?month=${month}`,
    gmailReauthorization: () => `${base}/settings?section=oauth`,
    smbcCardStatement: month => `${SMBC_CARD_STATEMENT_URL}?p01=${String(month).replace('-', '')}`,
    smbcBankStatement: () => SMBC_BANK_STATEMENT_URL,
  }
}
