/**
 * 自動分類・学習コンテキストのテストフィクスチャ
 */
import type {
  AmazonProductKeyLearningRule,
  BulkClassificationSession,
  MerchantLearningRule,
  UserId,
} from '@warimaru/domain'
import {
  AmazonProductKeyLearningRuleSchema,
  BulkClassificationSessionSchema,
  MerchantLearningRuleSchema,
} from '@warimaru/domain'
import { newUlid } from '../../src/newId'
import { HONEY_USER_ID } from './fixtures'

export function activeMerchantRule(
  input: { userId?: UserId; merchantName?: string } = {},
): MerchantLearningRule {
  return MerchantLearningRuleSchema.parse({
    kind: 'active',
    common: {
      userId: input.userId ?? HONEY_USER_ID,
      merchantName: input.merchantName ?? 'テストスーパー',
    },
    categoryRef: { kind: 'learned', categoryId: newUlid() },
    expenseClassRef: { kind: 'learned', expenseClass: 'household' },
    expenseTypeRef: { kind: 'unlearned' },
    lastUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
  })
}

export function disabledMerchantRule(
  input: { userId?: UserId; merchantName?: string } = {},
): MerchantLearningRule {
  return MerchantLearningRuleSchema.parse({
    kind: 'disabled',
    common: {
      userId: input.userId ?? HONEY_USER_ID,
      merchantName: input.merchantName ?? '学習しないストア',
    },
    disabledAt: new Date('2026-07-02T00:00:00.000Z'),
  })
}

export function amazonRule(
  input: { userId?: UserId; amazonProductKey?: string } = {},
): AmazonProductKeyLearningRule {
  return AmazonProductKeyLearningRuleSchema.parse({
    userId: input.userId ?? HONEY_USER_ID,
    amazonProductKey: input.amazonProductKey ?? '本',
    categoryRef: { kind: 'learned', categoryId: newUlid() },
    expenseClassRef: { kind: 'learned', expenseClass: 'business_expense' },
    expenseTypeRef: { kind: 'learned', expenseTypeId: newUlid() },
    lastUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
  })
}

export function inProgressSession(input: { userId?: UserId } = {}): BulkClassificationSession {
  return BulkClassificationSessionSchema.parse({
    kind: 'in_progress',
    common: {
      bulkClassificationSessionId: newUlid(),
      userId: input.userId ?? HONEY_USER_ID,
      trigger: {
        kind: 'csv_import',
        importJobId: newUlid(),
        startedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      targets: [
        {
          kind: 'unclassified',
          transactionId: newUlid(),
          merchantName: '未分類ストア',
          reason: 'merchant_rule_unlearned',
          defaultExpenseClass: 'personal_honey',
        },
      ],
    },
    startedAt: new Date('2026-07-01T00:00:00.000Z'),
    remainingCount: 1,
  })
}

export function abortedSession(input: { userId?: UserId } = {}): BulkClassificationSession {
  const base = inProgressSession(input)
  return BulkClassificationSessionSchema.parse({
    kind: 'aborted',
    common: base.common,
    startedAt: base.startedAt,
    abortedAt: new Date('2026-07-01T01:00:00.000Z'),
    remainingCount: 1,
  })
}
