/**
 * LINE Channel 設定値参照 Query I/F（通知配信が読む）
 * @see docs/domain/08h-ul-マスタ管理.md §2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 */
import type { LineChannelConfig } from '../aggregates/Phase0Config'

export interface LineChannelConfigQuery {
  fetch(): Promise<LineChannelConfig>
}
