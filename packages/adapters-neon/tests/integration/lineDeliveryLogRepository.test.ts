import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import type { DeliveryLogId, LineDeliveryLog } from '@warimaru/domain'
import { InvariantViolationError, LineDeliveryLogSchema } from '@warimaru/domain'
import { db } from './setup'
import { NeonLineDeliveryLogRepository } from '../../src/notification-delivery/NeonLineDeliveryLogRepository'
import { deliveryLog } from '../helpers/notificationFixtures'

const repo = new NeonLineDeliveryLogRepository(db)

describe('NeonLineDeliveryLogRepository（append-only 監査レコード）', () => {
  it('save → findById / findByIdempotencyKey の往復同一性', async () => {
    const log = deliveryLog({ idempotencyKey: 'idem-2026-07-reminder' })
    await repo.save(log)
    expect(await repo.findById(log.deliveryLogId)).toEqual(log)
    expect(await repo.findByIdempotencyKey('idem-2026-07-reminder')).toEqual(log)
    expect(await repo.findByIdempotencyKey('idem-none')).toBeNull()
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

  it('同一冪等性キーの別ログは InvariantViolationError（再送信の重複防止、OQ-34）', async () => {
    await repo.save(deliveryLog({ idempotencyKey: 'idem-dup' }))
    await expect(repo.save(deliveryLog({ idempotencyKey: 'idem-dup' }))).rejects.toThrow(
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
