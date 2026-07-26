import { describe, it, expect } from 'vitest'
import type { BankDeposit, BankDepositId, TransactionId, UserId } from '@warimaru/domain'
import { confirmBankDepositPurpose, recordBankDeposit } from '@warimaru/domain'
import { db } from './setup'
import { NeonBankDepositRepository } from '../../src/balance-asset-tracking/NeonBankDepositRepository'
import { newUlid } from '../../src/newId'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'

const repo = new NeonBankDepositRepository(db)

const REIMBURSEMENT_ID = newUlid()

function deposit(
  input: {
    userId?: UserId
    purpose?: Parameters<typeof recordBankDeposit>[0]['purpose']
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
    purpose: input.purpose ?? 'unknown',
    expenseReimbursementId: REIMBURSEMENT_ID as never,
  })
}

describe('NeonBankDepositRepository', () => {
  it('save → findById の往復同一性（全 4 kind 変種）', async () => {
    for (const purpose of ['salary', 'expense_reimbursement', 'other_savings_return', 'unknown']) {
      const saved = deposit({ purpose: purpose as never })
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

  it('同一取引ID の別入金は一意制約で弾かれる（同じ入金メールの再取込で二重加算しない）', async () => {
    const transactionId = newUlid()
    await repo.save(deposit({ transactionId }))
    await expect(repo.save(deposit({ transactionId }))).rejects.toThrow()
  })
})
