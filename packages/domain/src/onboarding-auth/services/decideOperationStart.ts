/**
 * 運用開始発火サービス（オンボーディング・認証コンテキスト）
 * @see docs/domain/08f-ul-オンボーディング認証.md §2「運用開始を発火する」「通知機能を有効化する」
 * @see docs/domain/09-aggregates.md #14 #14b
 * @see docs/domain/03-open-questions.md 論点16 / OQ-55 ①
 *
 * 「両者の Phase2 完了が揃ったら運用開始済みへ遷移する」（論点16）は Honey / Darling 2 つの
 * AppUser にまたがる判定であり、集約単体の遷移関数（`startOperation`）では表せない。続く
 * 「通知機能を有効化する」も 2 人の AppUser と世帯の `SharedTalkRoom` にまたがるため、
 * 両方の判定をここに一元的に置く（CLAUDE.md「ドメイン不変条件を adapters/api 層で再実装しない」）。
 *
 * 発火の起点は複数ある（自分の Phase2 完了・配偶者完了検知の画面ロード・LINE 運用記録の更新）。
 * どの起点から呼んでも同じ結論になるよう判定は純粋関数に閉じ、永続化とイベント発行は
 * application 層が行う。判定は現在の状態のみに依存するため、再実行しても結論は変わらない。
 */
import { InvariantViolationError } from '../../shared/errors/DomainError'
import type { TalkRoomId } from '../../shared/ids'
import {
  lineOperationSettingsOf,
  startOperation,
  type AppUser,
  type OperationStartedUser,
} from '../aggregates/AppUser'
import {
  isHouseholdNotificationActivated,
  type HouseholdNotificationActivation,
} from '../aggregates/HouseholdNotificationActivation'
import { joinedTalkRoomIdOf, type SharedTalkRoom } from '../aggregates/SharedTalkRoom'
import { activateNotification } from './activateNotification'

/** 世帯の夫婦 2 人（世帯は Honey / Darling の 2 人固定、OQ-53 ②）。未登録は null */
export interface HouseholdMembers {
  readonly honey: AppUser | null
  readonly darling: AppUser | null
}

/** 両者とも運用開始済みの世帯（08f §2 の `運用開始済みユーザー(Honey) AND (Darling)`） */
export interface OperationStartedHousehold {
  readonly honey: OperationStartedUser
  readonly darling: OperationStartedUser
}

/** 運用開始を発火できない理由 */
export type OperationStartBlocker =
  /** 夫婦のどちらかがアプリユーザー未登録 */
  | 'member_unregistered'
  /** どちらかが Phase2 完了に達していない（片方のみ完了では発火しない、論点16） */
  | 'phase2_incomplete'

export type OperationStartDecision =
  | { kind: 'not_ready'; blocker: OperationStartBlocker }
  /** 既に両者とも運用開始済み（再実行時。イベントは再発行しない） */
  | { kind: 'already_started'; household: OperationStartedHousehold }
  | {
      kind: 'start'
      household: OperationStartedHousehold
      /**
       * 今回の判定で運用開始済みへ遷移したユーザー（= 保存が要る対象）。
       * 片方の保存だけが済んだ状態から再実行された場合は、残りの 1 人だけがここに入る。
       */
      transitioned: readonly OperationStartedUser[]
      /**
       * 世帯の運用開始日時（遅い方の運用開始日時）。呼出し側の時計ではなく**保存される値**から
       * 導く — イベントに載る日時が再発火のたびに変わると、下流が日時を冪等性キーに使えない。
       */
      operationStartedAt: Date
    }

type MemberStartOutcome = { user: OperationStartedUser; transitioned: boolean } | null

/** 1 人分の運用開始遷移。既に運用開始済みならそのまま返す（冪等） */
function ensureOperationStarted(user: AppUser, at: Date): MemberStartOutcome {
  if (user.kind === 'operation_started') return { user, transitioned: false }
  if (user.kind === 'phase2_completed')
    return { user: startOperation(user, at), transitioned: true }
  return null
}

/**
 * 運用開始を発火するか判定する（08f §2「運用開始を発火する」）。
 *
 * 事前条件は「夫婦両方が Phase2 完了以降」であり、片方のみ完了では発火しない（論点16）。
 * 遷移後のユーザーを返すだけで保存はしない。
 */
export function decideOperationStart(members: HouseholdMembers, at: Date): OperationStartDecision {
  const { honey, darling } = members
  if (honey === null || darling === null) {
    return { kind: 'not_ready', blocker: 'member_unregistered' }
  }
  // 運用開始イベントは Honey / Darling の userID を役割ごとに載せる（08f §3）。スロットと集約が
  // 持つ役割が食い違ったまま発火すると、2 人の identity が入れ替わったイベントが世帯に流れる
  if (honey.common.role !== 'honey' || darling.common.role !== 'darling') {
    throw new InvariantViolationError(
      '世帯のメンバーは Honey / Darling の役割と対応していなければならない',
    )
  }
  const startedHoney = ensureOperationStarted(honey, at)
  const startedDarling = ensureOperationStarted(darling, at)
  if (startedHoney === null || startedDarling === null) {
    return { kind: 'not_ready', blocker: 'phase2_incomplete' }
  }

  const household: OperationStartedHousehold = {
    honey: startedHoney.user,
    darling: startedDarling.user,
  }
  const transitioned = [startedHoney, startedDarling]
    .filter(outcome => outcome.transitioned)
    .map(outcome => outcome.user)
  if (transitioned.length === 0) return { kind: 'already_started', household }
  return {
    kind: 'start',
    household,
    transitioned,
    operationStartedAt: latestOf([
      household.honey.operationStartedAt,
      household.darling.operationStartedAt,
    ]),
  }
}

/** 複数の日時のうち最も遅いもの */
function latestOf(dates: readonly Date[]): Date {
  return new Date(Math.max(...dates.map(date => date.getTime())))
}

/** 世帯の通知機能を有効化できない理由 */
export type HouseholdNotificationBlocker =
  /** 運用開始前（有効化は運用開始済みの夫婦を前提とする、08f §2） */
  | 'operation_not_started'
  /** どちらかが LINE 友達未追加 */
  | 'friend_not_added'
  /** 世帯が共通トークルーム未参加（配信先が決まらない、OQ-55 ①） */
  | 'talk_room_not_joined'

export type HouseholdNotificationDecision =
  | { kind: 'not_ready'; blocker: HouseholdNotificationBlocker }
  /** 世帯として有効化済み（テスト送信を依頼済み。イベントは再発行しない、#447） */
  | { kind: 'already_activated' }
  | {
      kind: 'activate'
      /** テスト送信の配信先。世帯レベルの `SharedTalkRoom` が唯一の正（#334） */
      talkRoomId: TalkRoomId
      /** 有効化で状態が変わったユーザー（= 保存が要る対象。事前蓄積で有効化済みなら含まれない） */
      changed: readonly AppUser[]
      /**
       * 世帯として通知機能が有効になった日時（遅い方の有効化日時）。呼出し側の時計ではなく
       * **保存される per-user の有効化日時**から導く — 下流（テスト送信）はこの日時を冪等性キーに
       * 使うため、再発火のたびに変わると同じテストメッセージが何通も届く
       */
      activatedAt: Date
    }

/**
 * 世帯の通知機能を有効化するか判定する（08f §2「通知機能を有効化する」）。
 *
 * 事前条件は「世帯が未有効化」「両者が運用開始済み」「両者とも友達追加済み」
 * 「世帯が共通トークルーム参加済み」の 4 つ。behavior の事前条件を application 層に割らないため、
 * 「もう依頼したか」の判定（`householdActivation`）もここで受け取る（#447）。
 * 有効化そのものは per-user の `activateNotification` に委ね、2 集約横断の不変条件を
 * 二重に実装しない。
 */
export function decideHouseholdNotificationActivation(
  members: HouseholdMembers,
  sharedTalkRoom: SharedTalkRoom,
  householdActivation: HouseholdNotificationActivation,
  at: Date,
): HouseholdNotificationDecision {
  // 世帯レベルの記録が「もう依頼したか」の唯一の根拠。per-user の有効化状態は根拠にしない
  // （保存に成功して発行に失敗した回を「もう送った」と誤認しないため、#447）
  if (isHouseholdNotificationActivated(householdActivation)) return { kind: 'already_activated' }

  const { honey, darling } = members
  if (
    honey === null ||
    darling === null ||
    honey.kind !== 'operation_started' ||
    darling.kind !== 'operation_started'
  ) {
    return { kind: 'not_ready', blocker: 'operation_not_started' }
  }
  const talkRoomId = joinedTalkRoomIdOf(sharedTalkRoom)
  if (talkRoomId === undefined) return { kind: 'not_ready', blocker: 'talk_room_not_joined' }

  const before: readonly AppUser[] = [honey, darling]
  if (before.some(user => lineOperationSettingsOf(user).friendAdd.kind !== 'added')) {
    return { kind: 'not_ready', blocker: 'friend_not_added' }
  }

  const activated = before.map(user => activateNotification(user, sharedTalkRoom, at))
  const changed = activated.filter((user, index) => user !== before[index])
  return {
    kind: 'activate',
    talkRoomId,
    changed,
    activatedAt: latestOf(activated.map(activatedAtOf)),
  }
}

/** 有効化済みユーザーの有効化日時（有効化直後のみを渡すため、未有効化は起こらない） */
function activatedAtOf(user: AppUser): Date {
  const activation = lineOperationSettingsOf(user).notificationActivation
  if (activation.kind !== 'activated') {
    throw new InvariantViolationError('有効化済みのユーザーには有効化日時が必要')
  }
  return activation.activatedAt
}
