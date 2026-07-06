import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { ZodError } from 'zod'
import { NeonTransactionRepository } from '../../src/household-analysis/NeonTransactionRepository'
import { db } from './setup'
import {
  HONEY_USER_ID,
  DARLING_USER_ID,
  classifiedTransaction,
  deletedTransaction,
  unclassifiedTransaction,
  ym,
} from '../helpers/fixtures'

const repo = new NeonTransactionRepository(db)

describe('NeonTransactionRepository', () => {
  it('save → findById の往復で全 kind が同一に復元される（Date 実体含む）', async () => {
    const variants = [
      unclassifiedTransaction(),
      classifiedTransaction(),
      classifiedTransaction({ expenseClass: 'business_expense' }),
      deletedTransaction(),
    ]
    for (const tx of variants) {
      await repo.save(tx)
      const found = await repo.findById(tx.common.transactionId)
      expect(found).toEqual(tx)
      expect(found?.common.occurredAt).toBeInstanceOf(Date)
    }
  })

  it('存在しない ID は null を返す', async () => {
    const missing = classifiedTransaction()
    expect(await repo.findById(missing.common.transactionId)).toBeNull()
  })

  it('save は upsert（2 回目の save が状態を上書きする）', async () => {
    const unclassified = unclassifiedTransaction()
    await repo.save(unclassified)
    // 同一 ID のまま分類済みへ遷移した集約を保存
    const classified = classifiedTransaction()
    const transitioned = {
      ...classified,
      common: { ...classified.common, transactionId: unclassified.common.transactionId },
    }
    await repo.save(transitioned)
    const found = await repo.findById(unclassified.common.transactionId)
    expect(found?.kind).toBe('classified')
  })

  it('findByMonth は JST 暦月で絞り込み、全 kind を occurredAt 昇順で返す', async () => {
    // JST 7/1 00:30 = UTC 6/30 15:30 → 7 月に属する
    const julEarly = classifiedTransaction({
      occurredAt: new Date('2026-06-30T15:30:00.000Z'),
    })
    // JST 6/30 23:30 = UTC 6/30 14:30 → 6 月に属する
    const junLate = classifiedTransaction({
      occurredAt: new Date('2026-06-30T14:30:00.000Z'),
    })
    // JST 8/1 00:00 ちょうど = UTC 7/31 15:00 → 8 月に属する（半開区間の右端）
    const augStart = classifiedTransaction({
      occurredAt: new Date('2026-07-31T15:00:00.000Z'),
    })
    const julDeleted = deletedTransaction({ occurredAt: new Date('2026-07-15T03:00:00.000Z') })
    const otherOwner = classifiedTransaction({
      ownerUserId: DARLING_USER_ID,
      occurredAt: new Date('2026-07-10T03:00:00.000Z'),
    })
    for (const tx of [julEarly, junLate, augStart, julDeleted, otherOwner]) {
      await repo.save(tx)
    }

    const found = await repo.findByMonth(HONEY_USER_ID, ym('2026-07'))
    expect(found.map(tx => tx.common.transactionId)).toEqual([
      julEarly.common.transactionId,
      julDeleted.common.transactionId,
    ])
  })

  it('payload 破損は findById 時に ZodError で検知される（superRefine 再適用）', async () => {
    const tx = classifiedTransaction({ expenseClass: 'business_expense' })
    await repo.save(tx)
    // business_expense なのに expenseTypeRef を non_business に書き換え（不変条件違反）
    await db.execute(
      sql`UPDATE transactions
          SET payload = jsonb_set(payload, '{details,expenseTypeRef}', '{"kind": "non_business"}')
          WHERE transaction_id = ${tx.common.transactionId}`,
    )
    await expect(repo.findById(tx.common.transactionId)).rejects.toThrow(ZodError)
  })
})
