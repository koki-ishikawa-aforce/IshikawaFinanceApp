/**
 * 加盟店名の正規化（OQ-23: NFKC 正規化 + 空白圧縮 + 長音統一）
 * @see docs/domain/08a-ul-取引取込.md §2
 * @see docs/domain/03-open-questions.md OQ-23
 *
 * 取込側（CSV / PDF / メール）で共通に適用する正規化規約。
 * `TransactionCandidateRepository.findByTripleMatch` の三項一致（発生日 + 金額 + 加盟店名）は
 * この正規化済み加盟店名を事前条件とするため、取込経路ごとに実装を分けてはならない。
 *
 * PDF や メールからの抽出では長音記号「ー」がハイフン類（‐ – — − 等）に化けることがあるため、
 * カタカナ直後のハイフン類を長音記号へ統一する。半角長音「ｰ」は NFKC が「ー」へ寄せる。
 */
export function normalizeMerchantName(raw: string): string {
  const nfkc = raw.normalize('NFKC')
  const choonUnified = nfkc.replace(/(?<=[゠-ヿ])[-‐-―−]/g, 'ー')
  return choonUnified.replace(/\s+/g, ' ').trim()
}
