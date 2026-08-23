import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { ZodError } from 'zod'
import { InvariantViolationError } from '@warimaru/domain'
import { PostgresAccountRepository } from '../../src/balance-asset-tracking/PostgresAccountRepository'
import { PostgresMitsuiSumitomoUnpaidRepository } from '../../src/balance-asset-tracking/PostgresMitsuiSumitomoUnpaidRepository'
import { db } from './setup'
import { DARLING_USER_ID, cardAccount, unpaidAggregate } from '../helpers/fixtures'

const accountRepo = new PostgresAccountRepository(db)
const repo = new PostgresMitsuiSumitomoUnpaidRepository(db)

describe('PostgresMitsuiSumitomoUnpaidRepository', () => {
  it('save → findById / findByCardAccountId の往復で同一に復元される（settled エントリ含む）', async () => {
    const account = cardAccount()
    await accountRepo.save(account)
    const unpaid = unpaidAggregate({
      accountId: account.common.accountId,
      withSettledEntry: true,
    })
    await repo.save(unpaid)
    expect(await repo.findById(unpaid.unpaidAggregateId)).toEqual(unpaid)
    expect(await repo.findByCardAccountId(account.common.accountId)).toEqual(unpaid)
  })

  it('同一カード口座への 2 件目の save は InvariantViolationError（口座 1 つにつき 1 件）', async () => {
    const account = cardAccount()
    await accountRepo.save(account)
    await repo.save(unpaidAggregate({ accountId: account.common.accountId }))
    await expect(
      repo.save(unpaidAggregate({ accountId: account.common.accountId })),
    ).rejects.toThrow(InvariantViolationError)
  })

  it('対応する accounts 行がない save は FK 違反がそのまま伝播する（翻訳しない）', async () => {
    const orphan = unpaidAggregate({ accountId: cardAccount().common.accountId })
    await expect(repo.save(orphan)).rejects.toThrow()
    await expect(repo.save(orphan)).rejects.not.toThrow(InvariantViolationError)
  })

  it('payload 破損（Σ 計上中 ≠ 合計）は読み出し時に ZodError（superRefine 再適用）', async () => {
    const account = cardAccount({ ownerUserId: DARLING_USER_ID })
    await accountRepo.save(account)
    const unpaid = unpaidAggregate({ accountId: account.common.accountId })
    await repo.save(unpaid)
    await db.execute(
      sql`UPDATE mitsui_sumitomo_unpaids
          SET payload = jsonb_set(payload, '{currentMonthUnpaidTotal}', '99999')
          WHERE unpaid_aggregate_id = ${unpaid.unpaidAggregateId}`,
    )
    await expect(repo.findById(unpaid.unpaidAggregateId)).rejects.toThrow(ZodError)
  })
})
