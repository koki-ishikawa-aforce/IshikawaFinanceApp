import { describe, it, expect } from 'vitest'
import { NotificationActivatedSchema } from '@warimaru/domain'
import { domainEventBase } from '../../src/event-handlers/event-base.js'
import { createTestApp } from '../helpers/test-app.js'

/**
 * チェーン: NotificationActivated → テストメッセージ送信（08g「テストメッセージを送信する」）
 * 開発モード配線（モック LINE ゲートウェイ = 常に成功）で結合検証する。
 */
describe('NotificationActivated イベントハンドラー', () => {
  const activatedAt = new Date('2026-07-01T10:00:00Z')

  function activatedEvent() {
    return NotificationActivatedSchema.parse({
      ...domainEventBase(),
      type: 'NotificationActivated',
      talkRoomId: 'room_e2e_001',
      activatedAt,
    })
  }

  it('通知機能有効化でテストメッセージが共通トークルームへ配信され、配信ログが残る', async () => {
    const { deps } = createTestApp()
    await deps.eventBus.publish(activatedEvent())

    const log = await deps.lineDeliveryLogRepository.findByIdempotencyKey(
      `test_message:room_e2e_001:${activatedAt.toISOString()}`,
    )
    expect(log).not.toBeNull()
    expect(log?.resultStatus.kind).toBe('success')
    expect(log?.timingKind).toBe('test_send')
    expect(log?.target).toEqual({ kind: 'shared_talk_room', talkRoomId: 'room_e2e_001' })
  })

  it('同一有効化イベントの再配信では二重送信しない（冪等）', async () => {
    const { deps } = createTestApp()
    await deps.eventBus.publish(activatedEvent())
    await deps.eventBus.publish(activatedEvent())

    const log = await deps.lineDeliveryLogRepository.findByIdempotencyKey(
      `test_message:room_e2e_001:${activatedAt.toISOString()}`,
    )
    expect(log).not.toBeNull()
    // 配信メッセージは 1 件のみ（2 件目は already_delivered でスキップされる）
    const message = await deps.deliveryMessageRepository.findById(log?.deliveryMessageId as never)
    expect(message?.kind).toBe('sent')
  })
})
