/**
 * 共通トークルーム Repository I/F（世帯レベル・シングルトン、OQ-55 ①）
 *
 * 世帯にひとつの記録のため識別子を取らない。記録が存在しない場合、find は
 * `not_joined`（未参加）を返す（未設定と未参加は同義）。
 */
import type { SharedTalkRoom } from '../aggregates/SharedTalkRoom'

export interface SharedTalkRoomRepository {
  find(): Promise<SharedTalkRoom>
  save(room: SharedTalkRoom): Promise<void>
}
