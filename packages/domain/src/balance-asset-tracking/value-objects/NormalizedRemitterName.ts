/**
 * 振込元名・振込先名の正規化（08d §1「正規化済み振込元名」、OQ-7 / OQ-21）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/03-open-questions.md OQ-21
 *
 * SMBC の入出金明細に載る相手方名は、同じ勤務先でも空白位置の表記ゆれと桁数上限による
 * 末尾欠落が起きる（OQ-21 の実調査）。パターン照合の前に必ずこの正規化を通す。
 *
 * アルゴリズムは加盟店名の正規化と同一（shared の `normalizeJapaneseName`）。ここで規則が
 * 割れると、同じ文字列でも取込経路によって照合できたりできなかったりする。
 */
import { normalizeJapaneseName } from '../../shared/value-objects/JapaneseNameNormalization'

export function normalizeRemitterName(raw: string): string {
  return normalizeJapaneseName(raw)
}
