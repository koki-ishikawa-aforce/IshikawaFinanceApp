import { describe, it, expect } from 'vitest'
import type {
  AwaitingMatchDeposit,
  ExpenseReimbursementId,
  MonthlyExpenseCycleId,
} from '@warimaru/domain'
import { matchDeposit } from '@warimaru/domain'
import { db } from './setup'
import { PostgresExpenseReimbursementDepositRepository } from '../../src/expense-settlement/PostgresExpenseReimbursementDepositRepository'
import { newUlid } from '../../src/newId'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import {
  awaitingDeposit,
  matchedDeposit,
  unrecognizedConfirmedDeposit,
} from '../helpers/expenseSettlementFixtures'

const repo = new PostgresExpenseReimbursementDepositRepository(db)

describe('PostgresExpenseReimbursementDepositRepository', () => {
  it('save → findById の往復同一性（全 3 kind 変種）', async () => {
    for (const deposit of [awaitingDeposit(), matchedDeposit(), unrecognizedConfirmedDeposit()]) {
      await repo.save(deposit)
      expect(await repo.findById(deposit.common.expenseReimbursementId)).toEqual(deposit)
    }
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as ExpenseReimbursementId)).toBeNull()
  })

  it('findAwaitingByUser は本人の突合待ちのみ返す（partial index の形）', async () => {
    const mine = awaitingDeposit({ userId: HONEY_USER_ID })
    await repo.save(mine)
    await repo.save(matchedDeposit({ userId: HONEY_USER_ID }))
    await repo.save(awaitingDeposit({ userId: DARLING_USER_ID }))
    expect(await repo.findAwaitingByUser(HONEY_USER_ID)).toEqual([mine])
  })

  it('突合の状態遷移を同一 ID の upsert で上書きできる', async () => {
    const awaiting = awaitingDeposit() as AwaitingMatchDeposit
    await repo.save(awaiting)
    const matched = matchDeposit(
      awaiting,
      newUlid() as MonthlyExpenseCycleId,
      new Date('2026-07-26T01:00:00.000Z'),
    )
    await repo.save(matched)
    expect(await repo.findById(awaiting.common.expenseReimbursementId)).toEqual(matched)
    expect(await repo.findAwaitingByUser(HONEY_USER_ID)).toEqual([])
  })
})
