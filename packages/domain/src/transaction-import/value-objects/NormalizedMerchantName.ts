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
