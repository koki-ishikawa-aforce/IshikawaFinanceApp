/**
 * LINE 友だち状態ゲートウェイ（外部システムへの driven port、ACL 翻訳層）
 * @see docs/domain/08f-ul-オンボーディング認証.md §2
 *
 * behavior LINE友達状態を照会する = LINE_userID -> 友達状態照会結果
 *
 * 登録前に友だち追加したユーザーの follow Webhook は、宛先のアプリユーザーが存在しないため
 * 記録されず破棄される（OQ-55 ③）。自己申告 API も廃止される（OQ-55 ②）ため、この照会が
 * 取りこぼしを拾い直す唯一の経路になる。呼出し元は次の 2 つで、いずれも友だち追加が未記録の
 * ときだけ照会する（`requiresFriendshipCheck`）:
 *
 *  - アプリユーザーの登録要求（新規登録の成立直後、および登録済みの冪等な再要求）
 *  - セットアップ画面からの明示的な確認（#417 A）
 *
 * follow Webhook は友だち追加の瞬間にしか発生せず再送されないため、照会が失敗した回の回復は
 * この 2 経路での再照会に依る（Webhook は回復経路にならない）。画面は登録要求を初回しか
 * 送らないため、登録要求だけでは利用者が自力で立て直せない（#417）。
 *
 * Conformist（順応者）: LINE Messaging API の仕様に従う薄い層で、独自の判断ロジックは持たない。
 * Channel Access Token の解決（マスタ管理の保管参照 → Parameter Store 復号）は実装側
 * （api 層）の責務で、ドメインにトークン実体を持ち込まない。
 *
 * 照会の失敗は例外ではなく `unknown` として返す。`not_friend` と区別できないと、通信断や
 * API 障害を根拠に「友だち未追加」を確定させてしまうため。
 */
import type { UserId } from '../../shared/ids'

export type LineFriendshipStatus =
  | { kind: 'friend' }
  | { kind: 'not_friend' }
  /**
   * 照会に失敗し、友だちかどうかを判定できない（API 障害・通信断・トークン解決失敗）。
   * detail は呼出し側がそのままログへ出すため、実装は**シークレット・PII・例外オブジェクトの
   * 中身を含めない**（LINE の応答ボディには displayName / pictureUrl が、トークン解決の例外には
   * Parameter Store のパスが含まれうる）。障害の種別が分かる短い文言に絞る。
   */
  | { kind: 'unknown'; detail: string }

export interface LineFriendshipGateway {
  /** LINE 公式アカウントを友だち追加済みかを照会する */
  checkFriendship(userId: UserId): Promise<LineFriendshipStatus>
}
