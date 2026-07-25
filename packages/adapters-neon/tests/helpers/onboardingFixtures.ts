/**
 * オンボーディング・認証コンテキストのテストフィクスチャ
 */
import type { AppUser, GmailOAuthToken, UserId, UserRole } from '@warimaru/domain'
import { AppUserSchema, GmailOAuthTokenSchema } from '@warimaru/domain'
import { newUlid } from '../../src/newId'
import { HONEY_USER_ID } from './fixtures'

export function phase1User(input: { userId?: UserId; role?: UserRole } = {}): AppUser {
  return AppUserSchema.parse({
    kind: 'phase1_completed',
    common: {
      userId: input.userId ?? HONEY_USER_ID,
      role: input.role ?? 'honey',
      firstRegisteredAt: new Date('2026-06-01T00:00:00.000Z'),
    },
  })
}

export function phase2InProgressUser(input: { userId?: UserId; role?: UserRole } = {}): AppUser {
  return AppUserSchema.parse({
    kind: 'phase2_in_progress',
    common: {
      userId: input.userId ?? HONEY_USER_ID,
      role: input.role ?? 'honey',
      nickname: 'はに',
      firstRegisteredAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    progress: {
      sectionA: {
        kind: 'completed',
        tokenStoreRef: '/warimaru/gmail/honey-token',
        completedAt: new Date('2026-06-02T00:00:00.000Z'),
      },
      sectionB: {
        kind: 'completed',
        initialBalanceRef: {
          smbcAccountId: newUlid(),
          otherSavingsAccountId: newUlid(),
          nisaAccountId: newUlid(),
        },
        completedAt: new Date('2026-06-03T00:00:00.000Z'),
      },
      sectionC: { kind: 'confirmed', confirmedAt: new Date('2026-06-04T00:00:00.000Z') },
      sectionD: { kind: 'edited', editedAt: new Date('2026-06-04T01:00:00.000Z'), editCount: 2 },
      sectionE: { kind: 'unconfirmed' },
      sectionF: { kind: 'skipped', skippedAt: new Date('2026-06-05T00:00:00.000Z') },
    },
  })
}

export function phase2CompletedUser(
  input: { userId?: UserId; role?: UserRole; phase2CompletedAt?: Date } = {},
): AppUser {
  const role = input.role ?? 'honey'
  return AppUserSchema.parse({
    kind: 'phase2_completed',
    common: {
      userId: input.userId ?? HONEY_USER_ID,
      role,
      firstRegisteredAt: new Date('2026-06-01T00:00:00.000Z'),
    },
    phase2CompletedAt: input.phase2CompletedAt ?? new Date('2026-06-10T00:00:00.000Z'),
    gmailTokenRef: {
      userId: input.userId ?? HONEY_USER_ID,
      tokenStoreRef: `/warimaru/gmail/${role}-token`,
    },
    initialBalanceRef: {
      smbcAccountId: newUlid(),
      otherSavingsAccountId: newUlid(),
      nisaAccountId: newUlid(),
    },
  })
}

export function operationStartedUser(
  input: { userId?: UserId; role?: UserRole; phase2CompletedAt?: Date } = {},
): AppUser {
  const base = phase2CompletedUser(input)
  if (base.kind !== 'phase2_completed') throw new Error('unreachable')
  const talkRoomId = 'talk-room-1'
  return AppUserSchema.parse({
    kind: 'operation_started',
    common: base.common,
    phase2CompletedAt: base.phase2CompletedAt,
    gmailTokenRef: base.gmailTokenRef,
    initialBalanceRef: base.initialBalanceRef,
    operationStartedAt: new Date('2026-06-20T00:00:00.000Z'),
    lineOperationSettings: {
      friendAdd: { kind: 'added', followWebhookReceivedAt: new Date('2026-06-15T00:00:00.000Z') },
      // 共通トークルーム参加は世帯レベルの SharedTalkRoom が持つ（OQ-55 ①）
      notificationActivation: {
        kind: 'activated',
        talkRoomId,
        activatedAt: new Date('2026-06-17T00:00:00.000Z'),
      },
    },
  })
}

export function validGmailToken(input: { userId?: UserId } = {}): GmailOAuthToken {
  return GmailOAuthTokenSchema.parse({
    kind: 'valid',
    userId: input.userId ?? HONEY_USER_ID,
    tokenStoreRef: '/warimaru/gmail/honey-token',
    authorizedAt: new Date('2026-06-02T00:00:00.000Z'),
    lastVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
  })
}

export function revokedGmailToken(input: { userId?: UserId } = {}): GmailOAuthToken {
  return GmailOAuthTokenSchema.parse({
    kind: 'revocation_detected',
    userId: input.userId ?? HONEY_USER_ID,
    tokenStoreRef: '/warimaru/gmail/honey-token',
    authorizedAt: new Date('2026-06-02T00:00:00.000Z'),
    revocationDetectedAt: new Date('2026-07-05T00:00:00.000Z'),
    revocationReason: 'api_call_failure',
  })
}
