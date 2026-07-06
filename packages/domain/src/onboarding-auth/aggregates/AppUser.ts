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
import { UserIdSchema } from '../../shared/ids'
import { UserRoleSchema } from '../../shared/value-objects/UserRole'
import { InvariantViolationError } from '../../shared/errors/DomainError'
import { NicknameSchema } from '../value-objects/Nickname'
import { Phase2ProgressSchema, type Phase2Progress } from '../value-objects/Phase2Progress'
import {
  LineOperationSettingsSchema,
  type LineOperationSettings,
} from '../value-objects/LineOperationSettings'
import { GmailOAuthTokenRefSchema } from '../value-objects/GmailOAuthTokenRef'
import { InitialBalanceRegistrationRefSchema } from '../value-objects/InitialBalanceRegistrationRef'

/** 共通属性（userId = LINE userID、OQ-15） */
export const CommonAppUserAttrsSchema = z.object({
  userId: UserIdSchema,
  role: UserRoleSchema,
  nickname: NicknameSchema.optional(),
  firstRegisteredAt: z.date(),
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

/** 状態遷移: Phase2完了 → 運用開始済み（両者完了検知後、論点16） */
export function startOperation(
  user: Phase2CompletedUser,
  settings: LineOperationSettings,
  at: Date,
): OperationStartedUser {
  return AppUserSchema.parse({
    kind: 'operation_started',
    common: user.common,
    phase2CompletedAt: user.phase2CompletedAt,
    gmailTokenRef: user.gmailTokenRef,
    initialBalanceRef: user.initialBalanceRef,
    operationStartedAt: at,
    lineOperationSettings: settings,
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
