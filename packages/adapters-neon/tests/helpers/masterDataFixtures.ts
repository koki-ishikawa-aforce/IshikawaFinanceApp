/**
 * マスタ管理コンテキストのテストフィクスチャ（Schema.parse を通した正規の集約）
 */
import type {
  CategoryDeletionRequest,
  CategoryMaster,
  DeletionRequestState,
  ExpenseTypeDeletionRequest,
  ExpenseTypeMaster,
  MonthlyLimit,
  Phase0Config,
  UserId,
} from '@warimaru/domain'
import {
  CategoryDeletionRequestSchema,
  CategoryMasterSchema,
  ExpenseTypeDeletionRequestSchema,
  ExpenseTypeMasterSchema,
  MonthlyLimitSchema,
  Phase0ConfigSchema,
} from '@warimaru/domain'
import { newUlid } from '../../src/newId'
import { HONEY_USER_ID } from './fixtures'

export function defaultCategory(input: { name?: string } = {}): CategoryMaster {
  return CategoryMasterSchema.parse({
    kind: 'default',
    categoryId: newUlid(),
    name: input.name ?? '食費',
    scope: { kind: 'household_shared' },
    defaultKind: 'food',
  })
}

export function customCategory(input: { name?: string; userId?: UserId } = {}): CategoryMaster {
  const userId = input.userId ?? HONEY_USER_ID
  return CategoryMasterSchema.parse({
    kind: 'custom',
    categoryId: newUlid(),
    name: input.name ?? '推し活',
    scope: { kind: 'personal', userId },
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    createdByUserId: userId,
    renameHistory: [],
  })
}

export function defaultExpenseType(input: { name?: string } = {}): ExpenseTypeMaster {
  return ExpenseTypeMasterSchema.parse({
    kind: 'default',
    expenseTypeId: newUlid(),
    name: input.name ?? 'ジム',
    scope: { kind: 'household_shared' },
    defaultKind: 'gym',
  })
}

export function customExpenseType(
  input: { name?: string; userId?: UserId } = {},
): ExpenseTypeMaster {
  const userId = input.userId ?? HONEY_USER_ID
  return ExpenseTypeMasterSchema.parse({
    kind: 'custom',
    expenseTypeId: newUlid(),
    name: input.name ?? 'セミナー',
    scope: { kind: 'personal', userId },
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    createdByUserId: userId,
    renameHistory: [],
  })
}

export function cappedLimit(
  input: { userId?: UserId; expenseTypeId?: string; capAmount?: number } = {},
): MonthlyLimit {
  return MonthlyLimitSchema.parse({
    kind: 'capped',
    monthlyLimitId: newUlid(),
    userId: input.userId ?? HONEY_USER_ID,
    expenseTypeId: input.expenseTypeId ?? newUlid(),
    effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
    capAmount: input.capAmount ?? 10000,
    changeHistory: [],
  })
}

export function unlimitedLimit(
  input: { userId?: UserId; expenseTypeId?: string } = {},
): MonthlyLimit {
  return MonthlyLimitSchema.parse({
    kind: 'unlimited',
    monthlyLimitId: newUlid(),
    userId: input.userId ?? HONEY_USER_ID,
    expenseTypeId: input.expenseTypeId ?? newUlid(),
    effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
  })
}

export function categoryDeletionRequest(
  input: {
    userId?: UserId
    targetCategoryId?: string
    destinationCategoryId?: string
    state?: DeletionRequestState
  } = {},
): CategoryDeletionRequest {
  return CategoryDeletionRequestSchema.parse({
    categoryDeletionRequestId: newUlid(),
    targetCategoryId: input.targetCategoryId ?? newUlid(),
    requestedByUserId: input.userId ?? HONEY_USER_ID,
    destinationCategoryId: input.destinationCategoryId ?? newUlid(),
    destinationExpenseClass: 'household',
    requestedAt: new Date('2026-07-01T00:00:00.000Z'),
    state: input.state ?? { kind: 'pending_remap' },
  })
}

export function expenseTypeDeletionRequest(
  input: {
    userId?: UserId
    targetExpenseTypeId?: string
    destinationExpenseTypeId?: string
    state?: DeletionRequestState
  } = {},
): ExpenseTypeDeletionRequest {
  return ExpenseTypeDeletionRequestSchema.parse({
    expenseTypeDeletionRequestId: newUlid(),
    targetExpenseTypeId: input.targetExpenseTypeId ?? newUlid(),
    requestedByUserId: input.userId ?? HONEY_USER_ID,
    destinationExpenseTypeId: input.destinationExpenseTypeId ?? newUlid(),
    requestedAt: new Date('2026-07-01T00:00:00.000Z'),
    state: input.state ?? { kind: 'pending_remap' },
  })
}

export function phase0Config(): Phase0Config {
  return Phase0ConfigSchema.parse({
    phase0ConfigId: newUlid(),
    lineChannel: {
      channelIdRef: '/warimaru/line/channel-id',
      channelSecretRef: '/warimaru/line/channel-secret',
      channelAccessTokenRef: '/warimaru/line/channel-access-token',
      insertedAt: new Date('2026-01-01T00:00:00.000Z'),
      officialAccountIdentifier: '@warimaru-test',
    },
    lineWebhook: {
      webhookUrl: 'https://example.com/webhook',
      lambdaBindingRef: 'warimaru-webhook-lambda',
      configuredAt: new Date('2026-01-01T01:00:00.000Z'),
    },
    allowlist: {
      honeyLineUserIdRef: '/warimaru/allowlist/husband-line-user-id',
      darlingLineUserIdRef: '/warimaru/allowlist/wife-line-user-id',
      insertedAt: new Date('2026-01-01T02:00:00.000Z'),
    },
  })
}
