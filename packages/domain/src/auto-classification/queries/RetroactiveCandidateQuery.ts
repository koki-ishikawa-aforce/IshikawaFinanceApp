/**
 * 遡及候補 Query I/F（J-3: 過去未分類への遡及提案）
 * @see docs/domain/08b-ul-自動分類学習.md §2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * F-1: userId は閲覧者かつ対象者。当該ユーザーの未分類取引のみを返す
 * （既分類・配偶者取引は対象外）。
 */
import type { UserId } from '../../shared/ids'
import type { RetroactiveCandidateView } from './views/RetroactiveCandidateView'

export interface RetroactiveCandidateQuery {
  fetchCandidates(userId: UserId, merchantName: string): Promise<RetroactiveCandidateView>
}
