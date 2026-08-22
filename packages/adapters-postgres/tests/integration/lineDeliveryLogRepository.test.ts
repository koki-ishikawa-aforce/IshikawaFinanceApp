import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import type { DeliveryLogId, LineDeliveryLog } from '@warimaru/domain'
import {
  concludesDelivery,
  InvariantViolationError,
  LineDeliveryLogSchema,
  SendFailureReasonSchema,
} from '@warimaru/domain'
import { db } from './setup'
import { NeonLineDeliveryLogRepository } from '../../src/notification-delivery/NeonLineDeliveryLogRepository'
import { deliveryLog, failedDeliveryLog, skippedDeliveryLog } from '../helpers/notificationFixtures'

const repo = new NeonLineDeliveryLogRepository(db)

describe('NeonLineDeliveryLogRepository（append-only 監査レコード）', () => {
  it('save → findById / findAllByIdempotencyKey の往復同一性', async () => {
    const log = deliveryLog({ idempotencyKey: 'idem-2026-07-reminder' })
    await repo.save(log)
    expect(await repo.findById(log.deliveryLogId)).toEqual(log)
    expect(await repo.findAllByIdempotencyKey('idem-2026-07-reminder')).toEqual([log])
    expect(await repo.findAllByIdempotencyKey('idem-none')).toEqual([])
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as DeliveryLogId)).toBeNull()
  })

  it('同一 ID の再 save は throw し、行が変化しない（UPDATE 経路なし）', async () => {
    const log = deliveryLog()
    await repo.save(log)
    const mutated: LineDeliveryLog = LineDeliveryLogSchema.parse({
      ...log,
      sentPayloadJson: '{"type":"text","text":"改ざん"}',
    })
    await expect(repo.save(mutated)).rejects.toThrow(InvariantViolationError)
    expect(await repo.findById(log.deliveryLogId)).toEqual(log)
  })

  it('確定済み（成功）の冪等性キーに別の確定ログは InvariantViolationError（再送信の重複防止、OQ-34）', async () => {
    await repo.save(deliveryLog({ idempotencyKey: 'idem-dup' }))
    await expect(repo.save(deliveryLog({ idempotencyKey: 'idem-dup' }))).rejects.toThrow(
      InvariantViolationError,
    )
  })

  it('確定済み（スキップ）の冪等性キーにも別の確定ログは保存できない', async () => {
    await repo.save(skippedDeliveryLog({ idempotencyKey: 'idem-dup-skipped' }))
    await expect(repo.save(deliveryLog({ idempotencyKey: 'idem-dup-skipped' }))).rejects.toThrow(
      InvariantViolationError,
    )
  })

  it('失敗ログは同一冪等性キーに複数件積める（#441-A の再送信を可能にする）', async () => {
    const first = failedDeliveryLog({ idempotencyKey: 'idem-retry' })
    const second = failedDeliveryLog({ idempotencyKey: 'idem-retry' })
    await repo.save(first)
    await repo.save(second)
    expect(await repo.findAllByIdempotencyKey('idem-retry')).toHaveLength(2)
  })

  it('確定させる失敗（timeout / invalid_target）は同一キーに 2 件目を保存できない', async () => {
    // 索引の述語（SQL）と domain の CONCLUDES_BY_FAILURE_REASON がずれると
    // 「再送信されるはずのものが弾かれる」「弾かれるはずのものが積まれる」が起きる。
    // 失敗理由を列挙して両者の一致を実 DB で押さえる
    for (const failureReason of SendFailureReasonSchema.options) {
      const key = `idem-reason-${failureReason}`
      const first = failedDeliveryLog({ idempotencyKey: key, failureReason })
      const second = failedDeliveryLog({ idempotencyKey: key, failureReason })
      await repo.save(first)
      const save = repo.save(second)
      if (concludesDelivery(first)) {
        await expect(save).rejects.toThrow(InvariantViolationError)
      } else {
        await save
        expect(await repo.findAllByIdempotencyKey(key)).toHaveLength(2)
      }
    }
  })

  it('発生日時の昇順で返す（保存順とずれていても時系列で並ぶ）', async () => {
    // 保存の順序と発生日時の順序を意図的に逆にする。並べ替えを外しても
    // 挿入順のまま返って通ってしまわないようにするため
    const later = failedDeliveryLog({
      idempotencyKey: 'idem-order',
      failedAt: new Date('2026-07-07T09:00:00.000Z'),
    })
    const earlier = failedDeliveryLog({
      idempotencyKey: 'idem-order',
      failedAt: new Date('2026-07-07T08:00:00.000Z'),
    })
    await repo.save(later)
    await repo.save(earlier)

    expect((await repo.findAllByIdempotencyKey('idem-order')).map(l => l.deliveryLogId)).toEqual([
      earlier.deliveryLogId,
      later.deliveryLogId,
    ])
  })

  it('失敗が続いたあとの成功は保存でき、失敗の履歴も残る', async () => {
    const failed = failedDeliveryLog({
      idempotencyKey: 'idem-recovered',
      failedAt: new Date('2026-07-07T00:05:00.000Z'),
    })
    const succeeded = deliveryLog({
      idempotencyKey: 'idem-recovered',
      sentAt: new Date('2026-07-07T00:06:00.000Z'),
    })
    await repo.save(failed)
    await repo.save(succeeded)
    const logs = await repo.findAllByIdempotencyKey('idem-recovered')
    expect(logs.map(l => l.resultStatus.kind)).toEqual(['failure', 'success'])
    // 確定したあとは、同じキーで二重に送って確定させることはできない
    await expect(repo.save(deliveryLog({ idempotencyKey: 'idem-recovered' }))).rejects.toThrow(
      InvariantViolationError,
    )
  })

  it('DDL: 不正な timing_kind を拒否する（23514）', async () => {
    try {
      await db.execute(
        sql`INSERT INTO line_delivery_logs (delivery_log_id, idempotency_key, timing_kind, payload)
            VALUES ('01HZZZZZZZZZZZZZZZZZZZZZY0', 'idem-x', 'bogus', '{}'::jsonb)`,
      )
      expect.unreachable('CHECK 制約が効いていない')
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } }
      expect(err.cause?.code ?? err.code).toBe('23514')
    }
  })
})
