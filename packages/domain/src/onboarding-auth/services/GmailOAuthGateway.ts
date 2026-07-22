/**
 * Gmail OAuth ゲートウェイ（外部システムへの driven port、ACL 翻訳層）
 * @see docs/domain/08f-ul-オンボーディング認証.md §2
 *
 * behavior Gmail OAuth認可を開始する = ユーザーID -> OAuth認可URL
 * behavior Gmail OAuth認可を完了する = ユーザーID AND 認可コード -> 有効トークン
 *
 * トークン実体（access / refresh token）はドメインに持ち込まない。認可コードの交換と
 * Parameter Store（KMS）への保管は実装側（api 層）の責務で、ドメインは保管先パス
 * （ParameterStorePath）のみ受け取る。コールバックの state への userId 封入・検証
 * （CSRF 対策）も実装側の責務とする（OQ-7: 認可は OS 標準ブラウザで行われるため、
 * コールバックは LIFF セッション外で到達する）。
 */
import type { UserId } from '../../shared/ids'
import type { ParameterStorePath } from '../../shared/value-objects/ParameterStorePath'

export interface GmailOAuthGateway {
  /** OAuth 認可 URL を発行する（state に userId を封入する） */
  buildAuthorizationUrl(userId: UserId): Promise<string>
  /** コールバックの state を検証して userId を復元し、認可コードを交換してトークンを保管する */
  completeAuthorization(
    state: string,
    authorizationCode: string,
  ): Promise<{ userId: UserId; tokenStoreRef: ParameterStorePath }>
}
