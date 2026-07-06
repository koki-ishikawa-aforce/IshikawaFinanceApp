/**
 * 配偶者完了検知 Query I/F
 * @see docs/domain/08f-ul-オンボーディング認証.md §2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * 論点19: 画面ロード時のみ判定する（ポーリング / WebSocket は使わない）。
 */
import type { UserId } from '../../shared/ids'
import type { SpouseCompletionResult } from '../value-objects/SpouseCompletionResult'

export interface SpouseCompletionQuery {
  check(viewerId: UserId): Promise<SpouseCompletionResult>
}
