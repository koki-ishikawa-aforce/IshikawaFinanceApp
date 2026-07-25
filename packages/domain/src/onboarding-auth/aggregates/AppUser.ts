/**
 * アプリユーザー集約（オンボーディング・認証コンテキスト）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/domain/09-aggregates.md #14
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * kawasima: data アプリユーザー = Phase1完了ユーザー OR Phase2進行中ユーザー OR
 *   Phase2完了ユーザー OR 運用開始済みユーザー
 *
 * 不変条件:
 *  - LINE_userID で一意（OQ-15: userId = LINE userID。Repository で保証、Phase 5 M-B）
 *  - Phase 遷移は前進のみ（後戻り遷移関数を提供しない）
 *  - 論点8: SectionA 完了後でなければ SectionB に進めない、
 *    SectionC/D/E の確認・編集は SectionB 完了後（superRefine）
 *  - ニックネームは本人のみ変更可（Phase 3.5。操作者検証は application service、Phase 5 M-B）
 */
import { z } from 'zod'
import { UserIdSchema, type ImportJobId, type UserId } from '../../shared/ids'
import { UserRoleSchema, type UserRole } from '../../shared/value-objects/UserRole'
import type { ParameterStorePath } from '../../shared/value-objects/ParameterStorePath'
import { InvariantViolationError } from '../../shared/errors/DomainError'
import { NicknameSchema, type Nickname } from '../value-objects/Nickname'
import { Phase2ProgressSchema, type Phase2Progress } from '../value-objects/Phase2Progress'
import {
  LineOperationSettingsSchema,
  type LineOperationSettings,
} from '../value-objects/LineOperationSettings'
import { GmailOAuthTokenRefSchema } from '../value-objects/GmailOAuthTokenRef'
import {
  InitialBalanceRegistrationRefSchema,
  type InitialBalanceRegistrationRef,
} from '../value-objects/InitialBalanceRegistrationRef'
import {
  SpouseCompletionResultSchema,
  type SpouseCompletionResult,
} from '../value-objects/SpouseCompletionResult'
import type { SharedTalkRoom } from './SharedTalkRoom'

/**
 * 共通属性（userId = LINE userID、OQ-15）
 *
 * lineOperationSettings は運用開始前に事前蓄積される LINE 運用設定（友達追加・
 * トークルーム参加・通知有効化。Web オンボーディングの完了記録や follow/join
 * Webhook で更新される、#41）。運用開始発火（startOperation）時に
 * `operation_started.lineOperationSettings` へ昇格し、common 側からは除去する
 * （二重管理の禁止は superRefine が検査）。未設定は全状態未着手と同義
 * （既存レコード互換のため optional）。
 */
export const CommonAppUserAttrsSchema = z.object({
  userId: UserIdSchema,
  role: UserRoleSchema,
  nickname: NicknameSchema.optional(),
  firstRegisteredAt: z.date(),
  lineOperationSettings: LineOperationSettingsSchema.optional(),
})
export type CommonAppUserAttrs = z.infer<typeof CommonAppUserAttrsSchema>

export const AppUserSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('phase1_completed'),
      common: CommonAppUserAttrsSchema,
    }),
    z.object({
      kind: z.literal('phase2_in_progress'),
      common: CommonAppUserAttrsSchema,
      progress: Phase2ProgressSchema,
    }),
    z.object({
      kind: z.literal('phase2_completed'),
      common: CommonAppUserAttrsSchema,
      phase2CompletedAt: z.date(),
      gmailTokenRef: GmailOAuthTokenRefSchema,
      initialBalanceRef: InitialBalanceRegistrationRefSchema,
    }),
    z.object({
      kind: z.literal('operation_started'),
      common: CommonAppUserAttrsSchema,
      phase2CompletedAt: z.date(),
      gmailTokenRef: GmailOAuthTokenRefSchema,
      initialBalanceRef: InitialBalanceRegistrationRefSchema,
      operationStartedAt: z.date(),
      lineOperationSettings: LineOperationSettingsSchema,
    }),
  ])
  .superRefine((user, ctx) => {
    if (user.kind === 'operation_started' && user.common.lineOperationSettings !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          '運用開始済みでは LINE 運用設定は集約直下（lineOperationSettings）に一本化する（common 側を持たない）',
        path: ['common', 'lineOperationSettings'],
      })
    }
    if (user.kind !== 'phase2_in_progress') return
    const { sectionA, sectionB, sectionC, sectionD, sectionE } = user.progress
    if (sectionB.kind === 'completed' && sectionA.kind !== 'completed') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SectionA 完了後でなければ SectionB に進めない（論点8: 順序強制）',
        path: ['progress', 'sectionB'],
      })
    }
    const laterSections = [
      ['sectionC', sectionC.kind !== 'unconfirmed'],
      ['sectionD', sectionD.kind !== 'unconfirmed'],
      ['sectionE', sectionE.kind !== 'unconfirmed'],
    ] as const
    for (const [name, touched] of laterSections) {
      if (touched && sectionB.kind !== 'completed') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `SectionB 完了後でなければ ${name} の確認・編集はできない（論点8）`,
          path: ['progress', name],
        })
      }
    }
  })
export type AppUser = z.infer<typeof AppUserSchema>

export type Phase1CompletedUser = Extract<AppUser, { kind: 'phase1_completed' }>
export type Phase2InProgressUser = Extract<AppUser, { kind: 'phase2_in_progress' }>
export type Phase2CompletedUser = Extract<AppUser, { kind: 'phase2_completed' }>
export type OperationStartedUser = Extract<AppUser, { kind: 'operation_started' }>

/** 状態遷移: Phase1完了 → Phase2進行中（全 Section 未着手） */
export function startPhase2(user: Phase1CompletedUser): Phase2InProgressUser {
  return AppUserSchema.parse({
    kind: 'phase2_in_progress',
    common: user.common,
    progress: {
      sectionA: { kind: 'not_started' },
      sectionB: { kind: 'not_started' },
      sectionC: { kind: 'unconfirmed' },
      sectionD: { kind: 'unconfirmed' },
      sectionE: { kind: 'unconfirmed' },
      sectionF: { kind: 'not_started' },
    },
  }) as Phase2InProgressUser
}

/**
 * 状態遷移: Phase2進行中 → Phase2完了
 * SectionA / SectionB が完了していなければ InvariantViolationError を throw する。
 * トークン参照・初期残高参照は完了済み Section から引き継ぐ。
 */
export function completePhase2(user: Phase2InProgressUser, at: Date): Phase2CompletedUser {
  const { sectionA, sectionB } = user.progress
  if (sectionA.kind !== 'completed' || sectionB.kind !== 'completed') {
    throw new InvariantViolationError(
      'Phase2 完了には SectionA（Gmail 連携）と SectionB（初期残高登録）の完了が必須',
    )
  }
  return AppUserSchema.parse({
    kind: 'phase2_completed',
    common: user.common,
    phase2CompletedAt: at,
    gmailTokenRef: { userId: user.common.userId, tokenStoreRef: sectionA.tokenStoreRef },
    initialBalanceRef: sectionB.initialBalanceRef,
  }) as Phase2CompletedUser
}

/**
 * 状態遷移: Phase2完了 → 運用開始済み（両者完了検知後、論点16）
 * 事前蓄積した LINE 運用設定（common.lineOperationSettings）を集約直下へ昇格し、
 * common 側からは除去する（以後は集約直下が唯一の置き場所）。
 */
export function startOperation(user: Phase2CompletedUser, at: Date): OperationStartedUser {
  const common = { ...user.common }
  delete common.lineOperationSettings
  return AppUserSchema.parse({
    kind: 'operation_started',
    common,
    phase2CompletedAt: user.phase2CompletedAt,
    gmailTokenRef: user.gmailTokenRef,
    initialBalanceRef: user.initialBalanceRef,
    operationStartedAt: at,
    lineOperationSettings: lineOperationSettingsOf(user),
  }) as OperationStartedUser
}

/** Phase2 進捗の更新（順序強制は schema の superRefine が検査する） */
export function updatePhase2Progress(
  user: Phase2InProgressUser,
  progress: Phase2Progress,
): Phase2InProgressUser {
  return AppUserSchema.parse({
    kind: 'phase2_in_progress',
    common: user.common,
    progress,
  }) as Phase2InProgressUser
}

/**
 * アプリユーザーを新規登録する（未登録 → Phase1完了、08f §2）
 * 事前条件の役割判定（許可リスト照合）と重複登録の拒否は application 層 +
 * Repository の一意制約（userId / role）が担う。
 */
export function registerAppUser(
  userId: UserId,
  role: UserRole,
  nickname: Nickname | undefined,
  at: Date,
): Phase1CompletedUser {
  return AppUserSchema.parse({
    kind: 'phase1_completed',
    common: {
      userId,
      role,
      ...(nickname !== undefined ? { nickname } : {}),
      firstRegisteredAt: at,
    },
  }) as Phase1CompletedUser
}

/**
 * ニックネームを変更する（Phase 3.5。undefined で未設定に戻す = 表示はロール名フォールバック）
 * 「本人のみ変更可」の操作者検証は application 層で行う（viewer 本人の集約のみ渡す）。
 */
export function changeNickname(user: AppUser, nickname: Nickname | undefined): AppUser {
  const common = { ...user.common }
  if (nickname !== undefined) common.nickname = nickname
  else delete common.nickname
  return AppUserSchema.parse({ ...user, common })
}

const EMPTY_LINE_OPERATION_SETTINGS: LineOperationSettings = {
  friendAdd: { kind: 'not_added' },
  notificationActivation: { kind: 'not_activated' },
}

/**
 * LINE 運用設定の読取り。運用開始済みは集約直下、それ以前は common の事前蓄積を読む
 * （未設定は全状態未着手と同義）。
 */
export function lineOperationSettingsOf(user: AppUser): LineOperationSettings {
  if (user.kind === 'operation_started') return user.lineOperationSettings
  return user.common.lineOperationSettings ?? EMPTY_LINE_OPERATION_SETTINGS
}

function withLineOperationSettings(user: AppUser, settings: LineOperationSettings): AppUser {
  if (user.kind === 'operation_started') {
    return AppUserSchema.parse({ ...user, lineOperationSettings: settings })
  }
  return AppUserSchema.parse({
    ...user,
    common: { ...user.common, lineOperationSettings: settings },
  })
}

/** LINE 友達追加を記録する（冪等: 追加済みなら変更しない） */
export function recordLineFriendAdded(user: AppUser, at: Date): AppUser {
  const settings = lineOperationSettingsOf(user)
  if (settings.friendAdd.kind === 'added') return user
  return withLineOperationSettings(user, {
    ...settings,
    friendAdd: { kind: 'added', followWebhookReceivedAt: at },
  })
}

/**
 * 通知機能を有効化する（冪等: 有効化済みなら変更しない）
 * 友達追加済み かつ 世帯の共通トークルーム参加済み でなければ InvariantViolationError を throw
 * する。有効化対象は世帯レベルの参加済みトークルーム（OQ-55 ①: 参加状態の「正」は
 * SharedTalkRoom 集約）。AppUser と SharedTalkRoom の 2 集約にまたがる不変条件のため、
 * VO（LineOperationSettings）ではなく本関数が強制する。
 */
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

/** Phase2 SectionA（Gmail 連携）を完了する。再認可による再完了（tokenStoreRef 更新）を許容する */
export function completeSectionA(
  user: Phase2InProgressUser,
  tokenStoreRef: ParameterStorePath,
  at: Date,
): Phase2InProgressUser {
  return updatePhase2Progress(user, {
    ...user.progress,
    sectionA: { kind: 'completed', tokenStoreRef, completedAt: at },
  })
}

/** Phase2 SectionB（初期残高登録）を完了する。SectionA 完了済みでなければ throw（論点8: 順序強制） */
export function completeSectionB(
  user: Phase2InProgressUser,
  initialBalanceRef: InitialBalanceRegistrationRef,
  at: Date,
): Phase2InProgressUser {
  if (user.progress.sectionA.kind !== 'completed') {
    throw new InvariantViolationError('SectionA 完了後でなければ SectionB に進めない（論点8）')
  }
  return updatePhase2Progress(user, {
    ...user.progress,
    sectionB: { kind: 'completed', initialBalanceRef, completedAt: at },
  })
}

/** Phase2 SectionF（過去明細取込）を完了する。スキップ後の実行（やり直し）は許容する */
export function completeSectionF(
  user: Phase2InProgressUser,
  importJobId: ImportJobId,
  at: Date,
): Phase2InProgressUser {
  return updatePhase2Progress(user, {
    ...user.progress,
    sectionF: { kind: 'completed', importJobId, completedAt: at },
  })
}

/** Phase2 SectionF をスキップする。完了済みからのスキップは InvariantViolationError */
export function skipSectionF(user: Phase2InProgressUser, at: Date): Phase2InProgressUser {
  if (user.progress.sectionF.kind === 'completed') {
    throw new InvariantViolationError('完了済みの SectionF はスキップできない')
  }
  return updatePhase2Progress(user, {
    ...user.progress,
    sectionF: { kind: 'skipped', skippedAt: at },
  })
}

type SpouseCompletedUser = Extract<AppUser, { kind: 'phase2_completed' | 'operation_started' }>

function asPhase2CompletedOrLater(user: AppUser | undefined): SpouseCompletedUser | null {
  if (user === undefined) return null
  return user.kind === 'phase2_completed' || user.kind === 'operation_started' ? user : null
}

/**
 * 配偶者完了を検知する（論点19: 画面ロード時のみ判定、08f §2）
 *
 * 「完了」= Phase2 完了以降（phase2_completed / operation_started）。
 * 両者完了なら both_completed（bothCompletedAt = 遅い方の phase2CompletedAt）、
 * そうでなければ awaiting_spouse。配偶者の AppUser が未登録のときの spouseUserId は
 * deps.resolveSpouseUserId（許可リスト解決）で補う。
 * Query 実装（Neon / モック）はこの規約を共有する。
 */
export async function detectSpouseCompletion(
  viewerId: UserId,
  users: readonly AppUser[],
  deps: { resolveSpouseUserId: () => Promise<UserId>; now: () => Date },
): Promise<SpouseCompletionResult> {
  const viewer = users.find(u => u.common.userId === viewerId)
  const spouse = users.find(u => u.common.userId !== viewerId)

  const viewerCompleted = asPhase2CompletedOrLater(viewer)
  const spouseCompleted = asPhase2CompletedOrLater(spouse)
  if (viewerCompleted !== null && spouseCompleted !== null) {
    const [honey, darling] =
      viewerCompleted.common.role === 'honey'
        ? [viewerCompleted, spouseCompleted]
        : [spouseCompleted, viewerCompleted]
    return SpouseCompletionResultSchema.parse({
      kind: 'both_completed',
      honeyUserId: honey.common.userId,
      darlingUserId: darling.common.userId,
      bothCompletedAt: new Date(
        Math.max(
          viewerCompleted.phase2CompletedAt.getTime(),
          spouseCompleted.phase2CompletedAt.getTime(),
        ),
      ),
    })
  }

  const spouseUserId = spouse?.common.userId ?? (await deps.resolveSpouseUserId())
  return SpouseCompletionResultSchema.parse({
    kind: 'awaiting_spouse',
    userId: viewerId,
    spouseUserId,
    detectedAt: deps.now(),
  })
}
