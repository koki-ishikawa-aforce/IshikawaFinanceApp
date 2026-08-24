/**
 * 加盟店名の正規化（OQ-23: NFKC 正規化 + 空白圧縮 + 長音統一）
 * @see docs/domain/08a-ul-取引取込.md §2
 * @see docs/domain/03-open-questions.md OQ-23
 *
 * 取込側（CSV / PDF / メール）で共通に適用する正規化規約。
 * `TransactionCandidateRepository.findByTripleMatch` の三項一致（発生日 + 金額 + 加盟店名）は
 * この正規化済み加盟店名を事前条件とするため、取込経路ごとに実装を分けてはならない。
 *
 * アルゴリズムは shared の `normalizeJapaneseName`（OQ-7 / OQ-23 共通規約）に委譲する。
 * 振込元名の正規化（08d 入金用途判別）と同じ規則でなければ照合が成立しないため。
 */
import { normalizeJapaneseName } from '../../shared/value-objects/JapaneseNameNormalization'

export function normalizeMerchantName(raw: string): string {
  return normalizeJapaneseName(raw)
}

/**
 * 加盟店名が Amazon での支払いを指すか（08a §2「Amazon注文とSMBCカード利用通知を突合する」の
 * 突合相手の絞り込み）。
 *
 * カード利用通知の加盟店名は `AMAZON CO JP`（実メール観察 2026-07-26）のほか、区切り記号や
 * 大文字小文字の違い（`AMAZON.CO.JP` / `Amazon.co.jp`）、サービス別の後置き（`AMAZON
 * MARKETPLACE` など）で届きうる。`normalizeMerchantName` は NFKC・空白圧縮・長音統一までしか
 * 行わず、大文字化も記号の除去もしないため、突合の判定はここで吸収する。
 *
 * 判定は「英数字だけに落として大文字化したものが AMAZON で始まるか」。記号の位置に依存せず、
 * 表記が増えても規則を足さずに済む。`AMAZONAS`（同じ綴りで始まる別の店）も真になるが、
 * 突合は金額と 3 日以内という条件も同時に満たす必要があるため、これだけで誤った紐付けには
 * ならない（万一当たっても、突合できなかった側は未分類として残るだけで金額は変わらない）。
 */
export function isAmazonMerchantName(merchantName: string): boolean {
  return merchantName
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase()
    .startsWith('AMAZON')
}
