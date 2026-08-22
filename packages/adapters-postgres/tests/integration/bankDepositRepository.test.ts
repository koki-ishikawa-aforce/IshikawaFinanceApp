import { describe, it, expect } from 'vitest'
import type {
  BankDeposit,
  BankDepositId,
  DepositPurpose,
  TransactionId,
  UserId,
} from '@warimaru/domain'
import { sql } from 'drizzle-orm'
import {
  InvariantViolationError,
  confirmBankDepositPurpose,
  recordBankDeposit,
} from '@warimaru/domain'
import { db } from './setup'
import { PostgresBankDepositRepository } from '../../src/balance-asset-tracking/PostgresBankDepositRepository'
import { newUlid } from '../../src/newId'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'

const repo = new PostgresBankDepositRepository(db)

const REIMBURSEMENT_ID = newUlid()

type PurposeKind = DepositPurpose['kind']

/** 判別サービスの戻り値（入金用途判別結果）と同じ形を組み立てる */
function purposeOf(kind: PurposeKind): DepositPurpose {
  return kind === 'unknown'
    ? { kind, provisionalHandling: 'awaiting_manual_confirmation' }
    : { kind }
}

function deposit(
  input: {
    userId?: UserId
    purpose?: PurposeKind
    occurredAt?: Date
    transactionId?: string
  } = {},
): BankDeposit {
  const occurredAt = input.occurredAt ?? new Date('2026-07-10T03:00:00.000Z')
  return recordBankDeposit({
    common: {
      bankDepositId: newUlid(),
      accountId: newUlid(),
      transactionId: input.transactionId ?? newUlid(),
      userId: input.userId ?? HONEY_USER_ID,
      amount: 300000,
      occurredAt,
      remitterName: '振込サービス ｶ)ﾜﾘﾏﾙｼｮｳｼﾞ',
      determinedAt: occurredAt,
    } as never,
    purpose: purposeOf(input.purpose ?? 'unknown'),
    expenseReimbursementId: REIMBURSEMENT_ID as never,
  })
}

describe('PostgresBankDepositRepository', () => {
  it('save → findById の往復同一性（全 4 kind 変種）', async () => {
    const purposes: PurposeKind[] = [
      'salary',
      'expense_reimbursement',
      'other_savings_return',
      'unknown',
    ]
    for (const purpose of purposes) {
      const saved = deposit({ purpose })
      await repo.save(saved)
      expect(await repo.findById(saved.common.bankDepositId)).toEqual(saved)
    }
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as BankDepositId)).toBeNull()
  })

  it('findByTransactionId で取引から入金を引ける', async () => {
    const saved = deposit()
    await repo.save(saved)
    expect(await repo.findByTransactionId(saved.common.transactionId)).toEqual(saved)
  })

  it('未知の取引ID は null', async () => {
    expect(await repo.findByTransactionId('01HZZZZZZZZZZZZZZZZZZZZZZZ' as TransactionId)).toBeNull()
  })

  it('findAwaitingManualConfirmationByUser は本人の用途不明のみ返す（partial index の形）', async () => {
    const mine = deposit({ userId: HONEY_USER_ID })
    await repo.save(mine)
    await repo.save(deposit({ userId: HONEY_USER_ID, purpose: 'salary' }))
    await repo.save(deposit({ userId: DARLING_USER_ID }))
    expect(await repo.findAwaitingManualConfirmationByUser(HONEY_USER_ID)).toEqual([mine])
  })

  it('手動確認待ちは発生順（古い入金が先）で返る', async () => {
    const newer = deposit({ occurredAt: new Date('2026-07-20T03:00:00.000Z') })
    const older = deposit({ occurredAt: new Date('2026-06-20T03:00:00.000Z') })
    await repo.save(newer)
    await repo.save(older)
    expect(
      (await repo.findAwaitingManualConfirmationByUser(HONEY_USER_ID)).map(
        d => d.common.bankDepositId,
      ),
    ).toEqual([older.common.bankDepositId, newer.common.bankDepositId])
  })

  it('用途の確定を同一 ID の upsert で上書きできる', async () => {
    const awaiting = deposit()
    await repo.save(awaiting)
    const confirmed = confirmBankDepositPurpose(awaiting, {
      purpose: 'salary',
      operatorUserId: HONEY_USER_ID,
      expenseReimbursementId: REIMBURSEMENT_ID as never,
      at: new Date('2026-07-26T01:00:00.000Z'),
    })
    await repo.save(confirmed)
    expect(await repo.findById(awaiting.common.bankDepositId)).toEqual(confirmed)
    expect(await repo.findAwaitingManualConfirmationByUser(HONEY_USER_ID)).toEqual([])
  })

  it('同一取引ID の別入金は一意制約で弾かれ、InvariantViolationError に翻訳される', async () => {
    const transactionId = newUlid()
    await repo.save(deposit({ transactionId }))
    // 生の pg エラーのままだと、呼び出し側が「取込済みならスキップ」を型で判定できない
    await expect(repo.save(deposit({ transactionId }))).rejects.toThrow(InvariantViolationError)
  })

  it('発生日時が同じなら bankDepositId 昇順になる（並び順の第 2 キーが効いている）', async () => {
    const sameMoment = new Date('2026-07-11T03:00:00.000Z')
    const a = deposit({ occurredAt: sameMoment })
    const b = deposit({ occurredAt: sameMoment })
    await repo.save(a)
    await repo.save(b)
    const expected = [a.common.bankDepositId, b.common.bankDepositId].sort()
    expect(
      (await repo.findAwaitingManualConfirmationByUser(HONEY_USER_ID)).map(
        d => d.common.bankDepositId,
      ),
    ).toEqual(expected)
  })

  it('未知の kind は CHECK 制約で拒否される（Repository を経由しない書き込みへの最終防衛）', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO bank_deposits
          (bank_deposit_id, transaction_id, account_id, user_id, kind, occurred_at, payload)
        VALUES
          (${newUlid()}, ${newUlid()}, ${newUlid()}, ${HONEY_USER_ID}, 'auto_salary',
           ${new Date('2026-07-10T03:00:00.000Z')}, ${'{}'}::jsonb)
      `),
    ).rejects.toThrow()
  })
})
