/**
 * LINE 友達追加の確認（照会するか / 照会結果をどう扱うか）の判定
 * @see docs/domain/08f-ul-オンボーディング認証.md §2「LINE友達状態を照会する」
 * @see docs/domain/03-open-questions.md OQ-55 ②③（#417 の追加解決）
 *
 * 08f が `behavior LINE友達状態を照会する` に定める規則
 *  - LINE_友達追加状態 = 未追加 のときだけ照会する（追加済みなら照会しない）
 *  - 照会不能 は 友達未追加 と区別する（API 障害を根拠に未追加を確定させない）。要求元へも
 *    区別したまま返す
 * を、ここに一元的に置く（CLAUDE.md「ドメイン不変条件を adapters / api 層で再実装しない」）。
 * api 層は LINE への照会・記録の保存・応答の整形だけを担い、可否の判断は持たない。
 */
import type { AppUser } from '../aggregates/AppUser'
import { lineOperationSettingsOf } from '../aggregates/AppUser'
import type { LineFriendshipStatus } from './LineFriendshipGateway'

/**
 * 友達追加確認結果（08f §2 `data 友達追加確認結果`）。照会結果そのもの
 * （`LineFriendshipStatus`）ではなく、記録まで済ませたうえでの結末を表す。
 *
 *  - `confirmed`: 友達追加が記録されている（今回の照会で記録した場合と、既に記録済みだった場合）
 *  - `not_friend`: 照会できたが、まだ友達追加されていない
 *  - `unavailable`: 照会そのものができなかった（API 障害・通信断・トークン解決失敗）
 */
export const FRIENDSHIP_CHECK_OUTCOMES = ['confirmed', 'not_friend', 'unavailable'] as const
export type FriendshipCheckOutcome = (typeof FRIENDSHIP_CHECK_OUTCOMES)[number]

/**
 * 友達状態の照会を行う必要があるか。
 *
 * 記録済みなら照会しても記録は変わらないため、LINE を呼ばない（利用者が確認を繰り返しても
 * 外部 API を叩き続けることにならない）。
 */
export function requiresFriendshipCheck(user: AppUser): boolean {
  return lineOperationSettingsOf(user).friendAdd.kind !== 'added'
}

/**
 * 照会結果を確認結果へ写す。
 *
 * `unknown`（照会不能）を `not_friend` に丸めない。丸めると、通信断や API 障害を根拠に
 * 「友達未追加」を確定させ、要求元は次にとるべき行動（LINE で友達追加する／やり直す）を
 * 出し分けられなくなる。
 */
export function friendshipCheckOutcomeOf(status: LineFriendshipStatus): FriendshipCheckOutcome {
  if (status.kind === 'friend') return 'confirmed'
  if (status.kind === 'not_friend') return 'not_friend'
  return 'unavailable'
}
