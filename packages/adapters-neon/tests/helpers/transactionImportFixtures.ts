/**
 * 取引取込コンテキストのテストフィクスチャ
 */
import type {
  DailyMailImportBatch,
  StatementImportJob,
  TransactionCandidate,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import {
  DailyMailImportBatchSchema,
  StatementImportJobSchema,
  TransactionCandidateSchema,
} from '@warimaru/domain'
import { newUlid } from '../../src/newId'
import { HONEY_USER_ID, ym } from './fixtures'

export function normalCandidate(
  input: {
    userId?: UserId
    merchantName?: string
    amount?: number
    occurredAt?: Date
    gmailMessageId?: string
  } = {},
): TransactionCandidate {
  return TransactionCandidateSchema.parse({
    kind: 'normal',
    common: {
      transactionCandidateId: newUlid(),
      userId: input.userId ?? HONEY_USER_ID,
      importSource: { kind: 'email', gmailMessageId: input.gmailMessageId ?? `gm-${newUlid()}` },
      merchantName: input.merchantName ?? 'テストスーパー',
      amount: input.amount ?? 1200,
      occurredAt: input.occurredAt ?? new Date('2026-07-05T03:00:00.000Z'),
    },
  })
}

export function csvCandidate(
  input: { userId?: UserId; merchantName?: string; amount?: number; occurredAt?: Date } = {},
): TransactionCandidate {
  return TransactionCandidateSchema.parse({
    kind: 'normal',
    common: {
      transactionCandidateId: newUlid(),
      userId: input.userId ?? HONEY_USER_ID,
      importSource: { kind: 'csv', csvFileId: newUlid(), rowNumber: 1 },
      merchantName: input.merchantName ?? 'CSVストア',
      amount: input.amount ?? 900,
      occurredAt: input.occurredAt ?? new Date('2026-07-06T03:00:00.000Z'),
    },
  })
}

export function pdfCandidate(
  input: {
    userId?: UserId
    pdfFileId?: string
    merchantName?: string
    amount?: number
    occurredAt?: Date
  } = {},
): TransactionCandidate {
  return TransactionCandidateSchema.parse({
    kind: 'normal',
    common: {
      transactionCandidateId: newUlid(),
      userId: input.userId ?? HONEY_USER_ID,
      importSource: {
        kind: 'pdf',
        pdfFileId: input.pdfFileId ?? newUlid(),
        pageNumber: 1,
        pdfConversionJobId: newUlid(),
      },
      merchantName: input.merchantName ?? 'PDFストア',
      amount: input.amount ?? 2400,
      occurredAt: input.occurredAt ?? new Date('2026-07-06T03:00:00.000Z'),
    },
  })
}

export function amazonMatchedCandidate(
  input: { userId?: UserId; smbcGmailMessageId?: string } = {},
): TransactionCandidate {
  return TransactionCandidateSchema.parse({
    kind: 'amazon_matched',
    common: {
      transactionCandidateId: newUlid(),
      userId: input.userId ?? HONEY_USER_ID,
      importSource: {
        kind: 'amazon_match',
        smbcGmailMessageId: input.smbcGmailMessageId ?? `gm-${newUlid()}`,
        amazonOrderId: `250-${newUlid()}`,
      },
      merchantName: 'AMAZON.CO.JP',
      amount: 3480,
      occurredAt: new Date('2026-07-04T03:00:00.000Z'),
    },
    products: [{ productName: 'ドメイン駆動設計', amazonProductKey: '本', productAmount: 3480 }],
    matchedAt: new Date('2026-07-04T09:00:00.000Z'),
  })
}

export function matchTimeoutCandidate(input: { userId?: UserId } = {}): TransactionCandidate {
  return TransactionCandidateSchema.parse({
    kind: 'match_timeout',
    common: {
      transactionCandidateId: newUlid(),
      userId: input.userId ?? HONEY_USER_ID,
      importSource: { kind: 'email', gmailMessageId: `gm-${newUlid()}` },
      merchantName: 'AMAZON.CO.JP',
      amount: 1980,
      occurredAt: new Date('2026-07-01T03:00:00.000Z'),
    },
    timedOutAt: new Date('2026-07-03T03:00:00.000Z'),
    timeoutDirection: 'smbc_first_awaiting_amazon',
  })
}

export function startedBatch(input: { userId?: UserId } = {}): DailyMailImportBatch {
  return DailyMailImportBatchSchema.parse({
    kind: 'started',
    common: {
      importBatchId: newUlid(),
      userId: input.userId ?? HONEY_USER_ID,
      launchedAt: new Date('2026-07-07T00:00:00.000Z'),
      targetPeriod: {
        from: new Date('2026-07-02T00:00:00.000Z'),
        to: new Date('2026-07-07T00:00:00.000Z'),
      },
    },
  })
}

export function completedBatch(input: { userId?: UserId } = {}): DailyMailImportBatch {
  const base = startedBatch(input)
  return DailyMailImportBatchSchema.parse({
    kind: 'completed',
    common: base.common,
    completedAt: new Date('2026-07-07T00:10:00.000Z'),
    importedCount: 5,
    duplicateExcludedCount: 2,
    failedCount: 0,
  })
}

export function uploadAcceptedJob(
  input: { userId?: UserId; targetMonth?: YearMonth; fileFormat?: 'csv' | 'pdf' } = {},
): StatementImportJob {
  return StatementImportJobSchema.parse({
    kind: 'upload_accepted',
    common: {
      importJobId: newUlid(),
      uploaderUserId: input.userId ?? HONEY_USER_ID,
      targetMonth: input.targetMonth ?? ym('2026-06'),
      fileKind: 'card_statement',
      fileFormat: input.fileFormat ?? 'csv',
      fileRef: newUlid(),
    },
    acceptedAt: new Date('2026-07-01T00:00:00.000Z'),
  })
}

export function completedJob(
  input: { userId?: UserId; targetMonth?: YearMonth; completedAt?: Date } = {},
): StatementImportJob {
  const base = uploadAcceptedJob(input)
  return StatementImportJobSchema.parse({
    kind: 'completed',
    common: base.common,
    completedAt: input.completedAt ?? new Date('2026-07-01T01:00:00.000Z'),
    summary: {
      newCount: 42,
      autoClassifiedEstimateCount: 30,
      unclassifiedEstimateCount: 12,
      duplicateExcludedCount: 3,
    },
  })
}

export function failedJob(
  input: { userId?: UserId; targetMonth?: YearMonth } = {},
): StatementImportJob {
  const base = uploadAcceptedJob({ ...input, fileFormat: 'pdf' })
  return StatementImportJobSchema.parse({
    kind: 'failed',
    common: base.common,
    failedAt: new Date('2026-07-01T02:00:00.000Z'),
    failureReason: {
      kind: 'pdf_conversion_failed',
      failureDetail: '変換タイムアウト',
      detectedAt: new Date('2026-07-01T02:00:00.000Z'),
    },
  })
}
