/**
 * LINE 共通トークルーム在籍ゲートウェイ（外部システムへの driven port、ACL 翻訳層）
 * @see docs/domain/08f-ul-オンボーディング認証.md §2「共通トークルーム在籍を照会する」
 * @see docs/domain/03-open-questions.md OQ-55 ①（#371 の追加解決）
 *
 * behavior 共通トークルーム在籍を照会する = 共通トークルームID AND トークルーム種別 AND 世帯のLINE_userID -> 在籍照会結果
 *
 * `join` Webhook の source は userId を含まないため、届いたトークルームが**この世帯のものか**は
 * イベント単体からは判定できない。署名検証が保証するのは「LINE から来た」ことだけで、公式
 * アカウントを自分のグループへ招待できる第三者も正規の `join` を発生させられる。共通トーク
 * ルームは家計サマリの配信先そのものなので、取り違えると世帯の金額が第三者に届く。
 * この照会が「招待されたトークルームに夫婦のいずれかが在籍しているか」を確かめる唯一の経路。
 *
 * Conformist（順応者）: LINE Messaging API の仕様に従う薄い層で、独自の判断ロジックは持たない。
 * Channel Access Token の解決（マスタ管理の保管参照 → Parameter Store 復号）は実装側（api 層）の
 * 責務で、ドメインにトークン実体を持ち込まない。
 *
 * 照会の失敗は例外ではなく `unknown` として返す。`not_member` と区別できないと、通信断や API
 * 障害を根拠に「夫婦のトークルームではない」を確定させてしまうため。ただし `join` は招待の瞬間に
 * しか発生せず再送されないので、`unknown` で見送った回の回復経路は自己申告 API（`POST
 * /api/onboarding/phase1/talk-room`）か招待のやり直しになる。
 */
import type { TalkRoomId, UserId } from '../../shared/ids'

/**
 * トークルームの種別。LINE は グループ（`group`）と複数人トーク（`room`）で在籍照会の
 * エンドポイントが分かれるため、`join` Webhook の source 種別をここまで運ぶ必要がある。
 */
export type LineTalkRoomKind = 'group' | 'room'

export type LineTalkRoomMembershipStatus =
  /** 世帯のいずれかのユーザーが在籍している */
  | { kind: 'member' }
  /** 照会したユーザーがいずれも在籍していない（＝この世帯のトークルームではない） */
  | { kind: 'not_member' }
  /**
   * 照会に失敗し、在籍しているかを判定できない（API 障害・通信断・トークン解決失敗）。
   * detail は呼出し側がそのままログへ出すため、実装は**シークレット・PII・例外オブジェクトの
   * 中身を含めない**（LINE の応答ボディには displayName / pictureUrl が、トークン解決の例外には
   * Parameter Store のパスが含まれうる）。障害の種別が分かる短い文言に絞る。
   */
  | { kind: 'unknown'; detail: string }

export interface LineTalkRoomMembershipQuery {
  talkRoomKind: LineTalkRoomKind
  talkRoomId: TalkRoomId
  /** 世帯に登録済みのアプリユーザーの LINE_userID。1 人でも在籍していれば `member` */
  userIds: readonly UserId[]
}

export interface LineTalkRoomMembershipGateway {
  /** 招待されたトークルームに世帯のユーザーが在籍しているかを照会する */
  checkMembership(query: LineTalkRoomMembershipQuery): Promise<LineTalkRoomMembershipStatus>
}
