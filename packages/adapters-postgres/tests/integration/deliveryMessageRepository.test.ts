import { describe, it, expect } from 'vitest'
import type { DeliveryMessageId, FailsafeEmailId } from '@warimaru/domain'
import { db } from './setup'
import { NeonDeliveryMessageRepository } from '../../src/notification-delivery/NeonDeliveryMessageRepository'
import { NeonFailsafeEmailRepository } from '../../src/notification-delivery/NeonFailsafeEmailRepository'
import {
  failedTestMessage,
  reservedFailsafeEmail,
  reservedReminderMessage,
  sentFailsafeEmail,
  sentPersonalSummaryMessage,
} from '../helpers/notificationFixtures'

describe('NeonDeliveryMessageRepository', () => {
  const repo = new NeonDeliveryMessageRepository(db)

  it('save → findById の往復同一性（reserved / sent / failed 変種、両配信先）', async () => {
    for (const message of [
      reservedReminderMessage(),
      sentPersonalSummaryMessage(),
      failedTestMessage(),
    ]) {
      await repo.save(message)
      expect(await repo.findById(message.common.deliveryMessageId)).toEqual(message)
    }
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as DeliveryMessageId)).toBeNull()
  })
})

describe('NeonFailsafeEmailRepository', () => {
  const repo = new NeonFailsafeEmailRepository(db)

  it('save → findById の往復同一性（reserved / sent 変種と状態遷移上書き）', async () => {
    const reserved = reservedFailsafeEmail()
    await repo.save(reserved)
    expect(await repo.findById(reserved.common.failsafeEmailId)).toEqual(reserved)

    const sent = sentFailsafeEmail()
    await repo.save(sent)
    expect(await repo.findById(sent.common.failsafeEmailId)).toEqual(sent)
  })

  it('未知の ID は null', async () => {
    expect(await repo.findById('01HZZZZZZZZZZZZZZZZZZZZZZZ' as FailsafeEmailId)).toBeNull()
  })
})
