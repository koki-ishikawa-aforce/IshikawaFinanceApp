import type { StatementFileKind, YearMonth } from '@warimaru/domain'

/**
 * 明細 CSV の取得元サイトへのリンク（spec §10.2）。
 *
 * ⚠ `packages/api/src/notification/deep-links.ts` の `smbcCardStatement` /
 * `smbcBankStatement` が同じ URL・同じ月パラメータ規則を持つ（LINE リマインダーの
 * リンク先）。依存の向き上 web から api を参照できないため複製になっている。
 * 片方だけ直すとリマインダーと画面のリンク先がずれるので、必ず対で更新すること。
 */

/** 三井住友カードの明細ダウンロード画面。対象月をクエリ `p01` で指定できる */
const SMBC_CARD_STATEMENT_URL = 'https://www.smbc-card.com/memx/web_meisai/top/index.html'

/**
 * 三井住友銀行（SMBC ダイレクト SP サイト）の入口。
 * 月をクエリで指定する手段が無いことは OQ-38 の実調査で確定済みのため、月は埋め込まない。
 */
const SMBC_BANK_STATEMENT_URL = 'https://direct3.smbc.co.jp/sp/web/'

/** 明細の取得元サイト URL。銀行は月を指定できないため `month` を使わない */
export function statementSiteUrl(fileKind: StatementFileKind, month: YearMonth): string {
  return fileKind === 'card_statement'
    ? `${SMBC_CARD_STATEMENT_URL}?p01=${month.replace('-', '')}`
    : SMBC_BANK_STATEMENT_URL
}
