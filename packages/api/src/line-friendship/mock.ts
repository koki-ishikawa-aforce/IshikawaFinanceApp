/**
 * LineFriendshipGateway の開発モード用モック（DATABASE_URL 未設定時に配線）。
 *
 * 実 LINE API を呼ばず、常に「友だち未追加」を返す。開発・テストでは LINE 側の友だち追加を
 * 再現できないため照会は空振りさせる。友だち追加を記録する自己申告 API は #298 で廃止済みで、
 * 記録の唯一の経路は follow Webhook（署名検証つき）のため、ローカルで記録を作るには
 * Webhook を模した署名付きリクエストを送るか、リポジトリへ直接書き込む。
 */
import type { LineFriendshipGateway, LineFriendshipStatus } from '@warimaru/domain'

export function createMockLineFriendshipGateway(): LineFriendshipGateway {
  return {
    checkFriendship(): Promise<LineFriendshipStatus> {
      return Promise.resolve({ kind: 'not_friend' })
    },
  }
}
