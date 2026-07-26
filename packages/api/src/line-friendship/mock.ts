/**
 * LineFriendshipGateway の開発モード用モック（DATABASE_URL 未設定時に配線）。
 *
 * 実 LINE API を呼ばず、常に「友だち未追加」を返す。開発・テストでは LINE 側の友だち追加を
 * 再現できないため、照会は空振りさせ、友だち追加の記録は既存の自己申告 API
 * （`POST /api/onboarding/phase1/line-friend`、廃止は #298）で行う。
 */
import type { LineFriendshipGateway, LineFriendshipStatus } from '@warimaru/domain'

export function createMockLineFriendshipGateway(): LineFriendshipGateway {
  return {
    checkFriendship(): Promise<LineFriendshipStatus> {
      return Promise.resolve({ kind: 'not_friend' })
    },
  }
}
