/**
 * join Webhook 由来の共通トークルーム参加を記録してよいかの判定
 * @see docs/domain/08f-ul-オンボーディング認証.md §2「join Webhook を受信する」
 * @see docs/domain/03-open-questions.md OQ-55 ①（#371 の追加解決）
 *
 * 08f が `behavior join Webhook を受信する` の事前条件として定める 2 つ
 *  - 未参加である（参加済みなら上書きしない）
 *  - 在籍照会結果 = 在籍あり
 * を、ここに一元的に置く（CLAUDE.md「ドメイン不変条件を adapters / api 層で再実装しない」）。
 * api 層は LINE への照会と保存・ログ出力だけを担い、可否の判断は持たない。
 *
 * 記録できない側へ倒す理由: 誤って記録すると「参加済みは上書きしない」規則によって誤った配信先が
 * 固定され、以後は自己申告 API でしか直せない。共通トークルームは家計サマリの配信先そのもの。
 */
import type { SharedTalkRoom } from '../aggregates/SharedTalkRoom'
import type { LineTalkRoomMembershipStatus } from './LineTalkRoomMembershipGateway'

/** 記録を見送る理由。api 層はこれをログの文言に対応づける */
export type SharedTalkRoomJoinSkipReason =
  /** 既に参加記録がある（別トークルームでも上書きしない） */
  | 'already_joined'
  /** 世帯のユーザーが在籍していない（第三者のトークルームへの招待） */
  | 'not_member'
  /** 在籍を確認できなかった（照会の失敗、または照会できるアプリユーザーが未登録） */
  | 'membership_unverified'

export type SharedTalkRoomJoinVerdict =
  | { kind: 'record' }
  | { kind: 'skip'; reason: SharedTalkRoomJoinSkipReason }
  /**
   * 一時障害で在籍を確認できなかった。`join` は再送されないため、Webhook 自体を失敗として
   * 返し、LINE の再送に回収を委ねる（署名検証鍵を解決できないときと同じ扱い）
   */
  | { kind: 'retry_later' }

/**
 * 在籍照会を行う必要があるか。
 *
 * 参加済みなら結果に関わらず記録は変わらないため、LINE を呼ばない（Webhook の応答パスに
 * 不要な外部呼び出しを乗せない）。
 */
export function requiresTalkRoomMembershipCheck(current: SharedTalkRoom): boolean {
  return current.kind !== 'joined'
}

/**
 * 在籍照会の結果まで踏まえて、参加を記録してよいかを決める。
 *
 * `membership` は照会結果。参加済みで照会を省いた場合と、照会対象のアプリユーザーが 1 人も
 * 登録されておらず照会自体ができなかった場合は `'not_checked'` を渡す。
 */
export function decideSharedTalkRoomJoin(
  current: SharedTalkRoom,
  membership: LineTalkRoomMembershipStatus | 'not_checked',
): SharedTalkRoomJoinVerdict {
  if (current.kind === 'joined') return { kind: 'skip', reason: 'already_joined' }
  if (membership === 'not_checked') return { kind: 'skip', reason: 'membership_unverified' }
  if (membership.kind === 'not_member') return { kind: 'skip', reason: 'not_member' }
  // 照会不能を「在籍あり」にも「在籍なし」にも倒さない。API 障害を根拠にどちらかを確定させると、
  // 第三者のトークルームを通すか、正規の招待を捨てるかのどちらかになる。
  // やり直して直る見込みがあるものだけ Webhook の再送へ回す
  if (membership.kind === 'unknown') {
    return membership.retryable
      ? { kind: 'retry_later' }
      : { kind: 'skip', reason: 'membership_unverified' }
  }
  return { kind: 'record' }
}
