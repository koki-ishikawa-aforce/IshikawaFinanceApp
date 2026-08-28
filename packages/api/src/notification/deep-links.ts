/**
 * LINE 通知本文の Deep Link URL 生成（#389 / OQ-54）
 *
 * OQ-54 は「受け側（web の既存ルート + クエリパラメータ）が受理する形を正式契約とし、
 * 送り側がそれに従う」と決めている。本モジュールがその送り側の単一実装で、
 * 契約は次の 3 本に限られる（パス形式の新ルートは Static Export と相性が悪く作らない）:
 *
 *   - 月次レポート:   `<base>/reports?month=YYYY-MM`
 *   - CSV 取込:       `<base>/imports?month=YYYY-MM`
 *   - Gmail 再認可:   `<base>/settings?section=oauth&provider=gmail`
 *     （論点57 の Deep Link マップ ④。受け側は設定画面の Gmail 連携タブ。`provider` は
 *     現状 gmail のみで受け側は読まないが、マップの表記どおりに送る — #392）
 *
 * レポートのビュー切替（`view=household|personal`）は OQ-54 ③ で「作らない」と決着済みのため、
 * 生成しない（受け側も受理しない）。
 *
 * ドメイン層ではなく api 層に置く理由: URL の形は web のルーティング契約であって
 * 通知配信のドメイン不変条件ではない（08g の `data リンクURL = 文字列` 以上の制約を持たない）。
 *
 * 一方、明細の取得元サイト（三井住友カード・SMBC ダイレクト）の URL は本モジュールが持たない。
 * 取込画面のガイドが同じリンクを出すため、ドメイン層の `statementSiteUrl` を単一実装とした（#472）。
 */
import type { YearMonth } from '@warimaru/domain'

/** 末尾スラッシュを落として `<base>/<path>` の二重スラッシュを防ぐ */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export interface DeepLinkBuilder {
  /** 月次レポート画面（OQ-54 ①） */
  monthlyReport(month: YearMonth): string
  /** CSV 取込画面（OQ-54 ①） */
  csvImport(month: YearMonth): string
  /** 設定画面の Gmail 連携タブ（論点57 ④。OAuth 失効通知の再認可導線 — #392） */
  gmailReauthorization(): string
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
    gmailReauthorization: () => `${base}/settings?section=oauth&provider=gmail`,
  }
}
