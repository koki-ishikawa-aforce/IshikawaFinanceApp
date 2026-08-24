/**
 * 明細取得元サイトURL（#472、spec §10.2）
 * @see docs/domain/08a-ul-取引取込.md §1「明細の取得元」
 *
 * 「どのサイトから、どの月の明細を取ってくるか」は明細ファイル種別（`StatementFileKind`）で
 * 決まる外部システムの知識であり、その種別を所有する本コンテキスト（取引取込）が併せて持つ。
 * 通知配信（08g）はリマインダー本文に「SMBC 明細ダウンロード URL を含める」と借用側の
 * 事後条件を書くに留まり、URL そのものの所有者ではない。
 *
 * 所有者を 1 つに定めた結果として、取込画面の取得手順ガイド（web）と CSV 取込リマインダー
 * （api）が同じ答えを返すことも保証される。以前は両者が URL と月パラメータ規則を別々に
 * 持っており、片方だけ直すと「LINE のリンクと画面のリンクが別のページを開く」状態になりえた
 * （どちらのテストも自分の側しか見ないため自動では検出できない）。
 *
 * ここに置かないもの: アプリ自身の画面 URL（`/imports?month=…` 等）は web のルーティング契約で
 * あってドメインの語彙ではないため、`packages/api/src/notification/deep-links.ts` が持つ。
 */
import type { StatementFileKind } from '../aggregates/StatementImportJob'
import type { YearMonth } from '../../shared/value-objects/YearMonth'

/** 三井住友カードの明細ダウンロード画面。対象月をクエリ `p01` で指定できる */
const SMBC_CARD_STATEMENT_URL = 'https://www.smbc-card.com/memx/web_meisai/top/index.html'

/**
 * 三井住友銀行（SMBC ダイレクト SP サイト）の入口。
 * 月をクエリで指定する手段が無いことは OQ-38 の実調査で確定済みのため、月は埋め込まない。
 */
const SMBC_BANK_STATEMENT_URL = 'https://direct3.smbc.co.jp/sp/web/'

/**
 * 種別ごとの取得元（URL の組み立てと、対象月を指定できるか）。
 *
 * 種別が増えたときの取りこぼしがコンパイルエラーになるよう `Record` で全種別を列挙する
 * （`card_statement` 以外を既定で銀行の入口に落とすと、画面と LINE の両方が同時に
 * 誤ったページへ誘導し、しかも失敗として表に出ない）。
 */
const STATEMENT_SITE_OF: Record<
  StatementFileKind,
  { readonly monthSupported: boolean; readonly urlOf: (month: YearMonth) => string }
> = {
  card_statement: {
    monthSupported: true,
    urlOf: month => `${SMBC_CARD_STATEMENT_URL}?p01=${String(month).replace('-', '')}`,
  },
  bank_statement: {
    monthSupported: false,
    urlOf: () => SMBC_BANK_STATEMENT_URL,
  },
}

/**
 * 明細取得元サイトの URL。
 *
 * 月を指定できない種別でも引数には常に対象月を取る（呼び出し側に種別ごとの月の有無を
 * 意識させないため）。指定が効くかどうかは `statementSiteMonthSupported` で判別する。
 */
export function statementSiteUrl(fileKind: StatementFileKind, month: YearMonth): string {
  return STATEMENT_SITE_OF[fileKind].urlOf(month)
}

/**
 * その種別の取得元サイトが、URL で対象月を指定できるか（明細取得元月指定可否）。
 *
 * 画面の案内文（「対象月の明細ページが開きます」か「月を指定して開けません」か）は
 * この判定に従う。URL の組み立てだけを共有して可否を画面側で別に分岐させると、
 * 取得元サイトの仕様が変わったときに URL と案内文が食い違う。
 */
export function statementSiteMonthSupported(fileKind: StatementFileKind): boolean {
  return STATEMENT_SITE_OF[fileKind].monthSupported
}
