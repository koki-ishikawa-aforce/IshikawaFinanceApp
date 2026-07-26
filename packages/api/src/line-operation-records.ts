/**
 * LINE 運用記録（友達追加 / 共通トークルーム参加）の適用
 * @see docs/domain/08f-ul-オンボーディング認証.md §1 §2
 *
 * 同じ事実を 2 つの入口が書き込む: Webhook 受信（`/webhook/line`、#296。LINE 側で実際に
 * 起きた事実が届く正の経路）と、移行期間だけ残る自己申告 API（`/api/onboarding/phase1/*`、
 * 廃止は #298）。「記録 → 変化したときだけ保存 → イベント発行」の手続きが両者で食い違うと
 * 片方だけ直す事故が起きるため、ここに一本化する。
 *
 * 冪等性: `recordLineFriendAdded` / `recordSharedTalkRoomJoined` はいずれも状態が変わらない
 * ときに元の値をそのまま返すため、参照比較で「変化したときだけ」を判定できる。
 */
import {
  LineFriendAddedSchema,
  LineTalkRoomJoinedSchema,
  recordLineFriendAdded,
  recordSharedTalkRoomJoined,
} from '@warimaru/domain'
import type {
  AppUser,
  AppUserRepository,
  EventBus,
  SharedTalkRoom,
  SharedTalkRoomRepository,
  TalkRoomId,
} from '@warimaru/domain'
import { domainEventBase } from './event-handlers/index.js'
import { tryFireOperationStart } from './operation-start.js'

/**
 * 記録の適用後に運用開始発火を試みる理由:
 * 友達追加・共通トークルーム参加は世帯の通知機能を有効化する前提条件（08f §2）であり、
 * 運用開始後に揃うこともある（招待し直し・後からの友だち追加）。そのとき発火し直さないと
 * テストメッセージが永久に届かず、per-user の有効化も未了のまま月次レポート配信まで止まる。
 * 発火は冪等で、条件が揃っていなければ何もしない。
 */
export interface LineFriendAddedDeps {
  appUserRepository: AppUserRepository
  sharedTalkRoomRepository: SharedTalkRoomRepository
  eventBus: EventBus
}

export interface SharedTalkRoomJoinedDeps {
  appUserRepository: AppUserRepository
  sharedTalkRoomRepository: SharedTalkRoomRepository
  eventBus: EventBus
}

/**
 * 友達追加を記録し、変化したときだけ保存して `LineFriendAdded` を発行する。
 * 返り値は適用後の AppUser（変化が無ければ引数と同一）。
 */
export async function applyLineFriendAdded(
  deps: LineFriendAddedDeps,
  user: AppUser,
  at: Date,
): Promise<AppUser> {
  const updated = recordLineFriendAdded(user, at)
  if (updated === user) return user
  await deps.appUserRepository.save(updated)
  await deps.eventBus.publish(
    LineFriendAddedSchema.parse({
      ...domainEventBase(at),
      type: 'LineFriendAdded',
      userId: updated.common.userId,
      receivedAt: at,
    }),
  )
  // 友達追加は世帯の通知機能有効化の前提。運用開始後に揃った場合はここが回復の起点になる
  await tryFireOperationStart(deps, { trigger: 'line_friend_added', at })
  return updated
}

/**
 * 共通トークルーム参加を記録し、変化したときだけ保存して `LineTalkRoomJoined` を発行する。
 * 現在の記録は呼び出し側が読んで渡す（呼び出し側が適用の可否を判断できるようにするため）。
 * 返り値は適用後の記録（変化が無ければ引数と同一）。
 */
export async function applySharedTalkRoomJoined(
  deps: SharedTalkRoomJoinedDeps,
  current: SharedTalkRoom,
  talkRoomId: TalkRoomId,
  at: Date,
): Promise<SharedTalkRoom> {
  const updated = recordSharedTalkRoomJoined(current, talkRoomId, at)
  if (updated === current) return current
  await deps.sharedTalkRoomRepository.save(updated)
  await deps.eventBus.publish(
    LineTalkRoomJoinedSchema.parse({
      ...domainEventBase(at),
      type: 'LineTalkRoomJoined',
      talkRoomId,
      receivedAt: at,
    }),
  )
  // 共通トークルーム参加は配信先そのもの。運用開始後の招待（し直し）はここが回復の起点になる
  await tryFireOperationStart(deps, { trigger: 'shared_talk_room_joined', at })
  return updated
}
