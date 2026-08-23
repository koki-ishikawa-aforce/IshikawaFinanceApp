import { describe, it, expect } from 'vitest'
import { db } from './setup'
import { PostgresTransactionRepository } from '../../src/household-analysis/PostgresTransactionRepository'
import { PostgresRetroactiveCandidateQuery } from '../../src/auto-classification/PostgresRetroactiveCandidateQuery'
import { DARLING_USER_ID, HONEY_USER_ID } from '../helpers/fixtures'
import { classifiedTransaction, unclassifiedTransaction } from '../helpers/fixtures'

const txRepo = new PostgresTransactionRepository(db)
const NOW = new Date('2026-07-07T00:00:00.000Z')
const query = new PostgresRetroactiveCandidateQuery(db, { now: () => NOW })

describe('PostgresRetroactiveCandidateQuery（J-3 遡及提案、transactions を Read 横断）', () => {
  it('本人の同一加盟店・未分類のみを発生日時昇順で返す', async () => {
    const older = unclassifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      merchantName: 'スーパーA',
      amount: 800,
      occurredAt: new Date('2026-07-01T03:00:00.000Z'),
    })
    const newer = unclassifiedTransaction({
      ownerUserId: HONEY_USER_ID,
      merchantName: 'スーパーA',
      amount: 1200,
      occurredAt: new Date('2026-07-03T03:00:00.000Z'),
    })
    // 対象外: 別加盟店 / 既分類 / 配偶者
    await txRepo.save(
      unclassifiedTransaction({ ownerUserId: HONEY_USER_ID, merchantName: '別ストア' }),
    )
    await txRepo.save(
      classifiedTransaction({ ownerUserId: HONEY_USER_ID, merchantName: 'スーパーA' }),
    )
    await txRepo.save(
      unclassifiedTransaction({ ownerUserId: DARLING_USER_ID, merchantName: 'スーパーA' }),
    )
    await txRepo.save(newer)
    await txRepo.save(older)

    const view = await query.fetchCandidates(HONEY_USER_ID, 'スーパーA')
    expect(view).toEqual({
      userId: HONEY_USER_ID,
      merchantName: 'スーパーA',
      candidates: [
        {
          transactionId: older.common.transactionId,
          occurredAt: older.common.occurredAt,
          amount: 800,
        },
        {
          transactionId: newer.common.transactionId,
          occurredAt: newer.common.occurredAt,
          amount: 1200,
        },
      ],
      proposedAt: NOW,
    })
  })

  it('該当なしなら candidates は空配列', async () => {
    const view = await query.fetchCandidates(HONEY_USER_ID, '存在しないストア')
    expect(view.candidates).toEqual([])
  })
})
