/**
 * LineTalkRoomMembershipGateway の開発モード用モック（DATABASE_URL 未設定時に配線）。
 *
 * 実 LINE API を呼ばず、常に「在籍あり」を返して在籍確認を素通しする。開発・テストでは LINE の
 * グループが存在せず、実装を呼べばすべて `unknown` になり join Webhook の経路そのものが
 * 動かせなくなるため。素通しでよいのは、この配線が DATABASE_URL 未設定の開発モード専用で、
 * 本番では `createDeps` がモックへのフォールバック自体を起動エラーにするから（composition-root）。
 *
 * 在籍確認が実際に働くこと（在籍なし・照会不能では記録しないこと）は、テスト側でこのモックを
 * 差し替えて検証する（`packages/api/tests/routes/line-webhook.test.ts`）。
 */
import type { LineTalkRoomMembershipGateway, LineTalkRoomMembershipStatus } from '@warimaru/domain'

export function createMockLineTalkRoomMembershipGateway(): LineTalkRoomMembershipGateway {
  return {
    checkMembership(): Promise<LineTalkRoomMembershipStatus> {
      return Promise.resolve({ kind: 'member' })
    },
  }
}
