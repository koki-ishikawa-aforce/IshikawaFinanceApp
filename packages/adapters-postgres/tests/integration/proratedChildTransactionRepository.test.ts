import { describe, it, expect } from 'vitest'
import type { ChildTransactionId, TransactionId } from '@warimaru/domain'
import { db } from './setup'
import { PostgresProratedChildTransactionRepository } from '../../src/expense-settlement/PostgresProratedChildTransactionRepository'
import { newUlid } from '../../src/newId'
import { proratedChild } from '../helpers/expenseSettlementFixtures'

const repo = new PostgresProratedChildTransactionRepository(db)

describe('PostgresProratedChildTransactionRepository', () => {
  it('save → findById の往復同一性', async () => {
    const child = proratedChild()
    await repo.save(child)
    expect(await repo.findById(child.childTransactionId)).toEqual(child)
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as ChildTransactionId)).toBeNull()
  })

  it('findByParent は同一親の按分子取引のみ返す', async () => {
    const parentTransactionId = newUlid() as TransactionId
    const first = proratedChild({ parentTransactionId })
    const second = proratedChild({ parentTransactionId })
    await repo.save(first)
    await repo.save(second)
    await repo.save(proratedChild()) // 別親

    const children = await repo.findByParent(parentTransactionId)
    expect(children).toHaveLength(2)
    expect(children.map(c => c.childTransactionId).sort()).toEqual(
      [first.childTransactionId, second.childTransactionId].sort(),
    )
  })

  it('同一 ID の再 save は上書き（再按分の更新）', async () => {
    const child = proratedChild()
    await repo.save(child)
    const updated = proratedChild({
      childTransactionId: child.childTransactionId,
      parentTransactionId: child.parentTransactionId,
    })
    await repo.save(updated)
    expect(await repo.findById(child.childTransactionId)).toEqual(updated)
  })
})
