/**
 * 共通トークルーム Repository I/F（世帯レベル・シングルトン、OQ-55 ①）
 *
 * 世帯にひとつの記録のため識別子を取らない。
 *
 * `find` は `Phase0ConfigRepository` と異なり null を返さない。共通トークルームは
 * 「記録が無い」＝「未参加」であり、ドメインに `not_joined` という有効な状態が存在するため、
 * 不在を null で表すと呼び出し側が同じ意味の2値を扱うことになる。
 * `save` は参加済みのみを受け取る（参加の取り消しは要件に無く、未参加の保存は意味を持たない）。
 */
import type { JoinedSharedTalkRoom, SharedTalkRoom } from '../aggregates/SharedTalkRoom'

export interface SharedTalkRoomRepository {
  find(): Promise<SharedTalkRoom>
  save(room: JoinedSharedTalkRoom): Promise<void>
}
