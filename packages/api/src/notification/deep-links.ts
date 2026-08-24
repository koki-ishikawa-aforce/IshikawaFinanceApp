/**
 * LINE 通知本文の Deep Link URL 生成（#389 / OQ-54）
 *
 * OQ-54 は「受け側（web の既存ルート + クエリパラメータ）が受理する形を正式契約とし、
 * 送り側がそれに従う」と決めている。本モジュールがその送り側の単一実装で、
 * 契約は次の 3 本に限られる（パス形式の新ルートは Static Export と相性が悪く作らない）:
 *
 *   - 月次レポート: `<base>/reports?month=YYYY-MM`
 *   - CSV 取込:     `<base>/imports?month=YYYY-MM`
 *
 * OQ-54 が例示する `settings?section=oauth` は生成しない。受け側の設定画面が受理する
 * section は profile / accounts / categories / expense-types / limits のみで `oauth` を
 * 受け付けず（未知値はプロフィールに落ちる）、Gmail 連携の UI 自体が設定画面に無いため、
 * 生成しても再認可へ誘導できない。この URL が要るのは OAuth 失効通知（別 Issue）の実装時で、
 * そのとき受け側と同時に契約を決める。
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
  }
}
