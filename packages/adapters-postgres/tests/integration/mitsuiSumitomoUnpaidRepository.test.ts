import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { ZodError } from 'zod'
import {
  AccountIdSchema,
  InvariantViolationError,
  MitsuiSumitomoUnpaidIdSchema,
  openMitsuiSumitomoUnpaid,
  registerMitsuiSumitomoCardAccount,
} from '@warimaru/domain'
import { PostgresAccountRepository } from '../../src/balance-asset-tracking/PostgresAccountRepository'
import { PostgresMitsuiSumitomoUnpaidRepository } from '../../src/balance-asset-tracking/PostgresMitsuiSumitomoUnpaidRepository'
import { newUlid } from '../../src/newId'
import { db } from './setup'
import { DARLING_USER_ID, HONEY_USER_ID, cardAccount, unpaidAggregate } from '../helpers/fixtures'

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

  it('カード口座の登録経路は「口座 → 未払金集約」の順でだけ通る（#395）', async () => {
    // 登録は 2 つの集約を別々に保存する（本番の接続方式では 1 トランザクションに束ねられない）。
    // 未払金集約の口座IDは口座への外部キーなので、順序を取り違えると本番でだけ登録が落ちる。
    const accountId = AccountIdSchema.parse(newUlid())
    const unpaidAggregateId = MitsuiSumitomoUnpaidIdSchema.parse(newUlid())
    const account = registerMitsuiSumitomoCardAccount({
      accountId,
      ownerUserId: HONEY_USER_ID,
      unpaidAggregateRef: unpaidAggregateId,
      at: new Date('2026-08-01T00:00:00.000Z'),
    })
    const unpaid = openMitsuiSumitomoUnpaid({ unpaidAggregateId, accountId })

    // 逆順（未払金集約が先）は保存できない
    await expect(repo.save(unpaid)).rejects.toThrow()

    await accountRepo.save(account)
    await repo.save(unpaid)
    expect(await repo.findByCardAccountId(accountId)).toEqual(unpaid)
    expect(await accountRepo.findById(accountId)).toEqual(account)
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
