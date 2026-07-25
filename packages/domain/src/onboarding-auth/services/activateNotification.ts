/**
 * 通知機能有効化サービス（オンボーディング・認証コンテキスト）
 * @see docs/domain/08f-ul-オンボーディング認証.md §2「通知機能を有効化する」
 * @see docs/domain/09-aggregates.md #14 #14b
 * @see docs/domain/03-open-questions.md OQ-55 ①
 *
 * 「アプリユーザー」と「共通トークルーム」の2集約にまたがる有効化の不変条件を、ここに
 * 一元的に置く（CLAUDE.md「ドメイン不変条件を adapters/api 層で再実装しない」）。
 * 共通トークルーム参加状態は世帯にひとつの事実として per-user の LINE_運用設定から
 * 分離済み（OQ-55 ①）のため、per-user の VO では検証できない。
 *
 * 不変条件:
 *  - 有効化には LINE 友達追加済み かつ 世帯の共通トークルーム参加済み が必要
 *  - 有効化対象のトークルームは世帯レベルの参加済みトークルーム
 */
import { InvariantViolationError } from '../../shared/errors/DomainError'
import {
  lineOperationSettingsOf,
  withLineOperationSettings,
  type AppUser,
} from '../aggregates/AppUser'
import type { SharedTalkRoom } from '../aggregates/SharedTalkRoom'

/** 通知機能を有効化する（冪等: 有効化済みなら変更しない） */
export function activateNotification(
  user: AppUser,
  sharedTalkRoom: SharedTalkRoom,
  at: Date,
): AppUser {
  const settings = lineOperationSettingsOf(user)
  if (settings.notificationActivation.kind === 'activated') return user
  if (settings.friendAdd.kind !== 'added' || sharedTalkRoom.kind !== 'joined') {
    throw new InvariantViolationError(
      '通知機能の有効化には LINE 友達追加と共通トークルーム参加の完了が必要',
    )
  }
  return withLineOperationSettings(user, {
    ...settings,
    notificationActivation: {
      kind: 'activated',
      talkRoomId: sharedTalkRoom.talkRoomId,
      activatedAt: at,
    },
  })
}
