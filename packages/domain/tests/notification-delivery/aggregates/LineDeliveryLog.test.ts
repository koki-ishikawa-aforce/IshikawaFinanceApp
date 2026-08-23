import { describe, it, expect } from 'vitest'
import {
  concludedDeliveryOf,
  concludesDelivery,
  createLineDeliveryLog,
  deliveryLogOccurredAt,
  LineDeliveryLogSchema,
} from '../../../src/notification-delivery/aggregates/LineDeliveryLog'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'
import {
  CommonDeliveryMessageAttrsSchema,
  DeliveryMessageSchema,
  DeliverySkipReasonSchema,
  SendFailureReasonSchema,
  type FailedDeliveryMessage,
  type SentDeliveryMessage,
  type SkippedDeliveryMessage,
} from '../../../src/notification-delivery/aggregates/DeliveryMessage'
import { DeliveryLogIdSchema } from '../../../src/shared/ids'

const base = {
  deliveryLogId: '01DG0000000000000000000001' as never,
  deliveryMessageId: '01MSG000000000000000000001' as never,
  timingKind: 'reminder',
  target: { kind: 'shared_talk_room', talkRoomId: 'room_001' as never },
  sentPayloadJson: '{"type":"flex"}',
  idempotencyKey: 'reminder-2026-07-room_001',
}

describe('LineDeliveryLog 集約', () => {
  it('成功 / 失敗 / スキップ の 3 結果ステータスとも parse 成功', () => {
    const statuses = [
      { kind: 'success', lineMessageId: 'line_msg_001' as never, sentAt: new Date() },
      { kind: 'failure', failureReason: 'line_api_failure', failedAt: new Date() },
      { kind: 'skipped', skipReason: 'notification_disabled', skippedAt: new Date() },
    ]
    for (const resultStatus of statuses) {
      expect(() => LineDeliveryLogSchema.parse({ ...base, resultStatus })).not.toThrow()
    }
  })

  it('冪等性キーが空文字なら parse 失敗（同月レポート再送信の重複防止）', () => {
    expect(() =>
      LineDeliveryLogSchema.parse({
        ...base,
        idempotencyKey: '',
        resultStatus: {
          kind: 'success',
          lineMessageId: 'line_msg_001' as never,
          sentAt: new Date(),
        },
      }),
    ).toThrow()
  })

  it('送信 payload が空なら parse 失敗（監査記録として不完全）', () => {
    expect(() =>
      LineDeliveryLogSchema.parse({
        ...base,
        sentPayloadJson: '',
        resultStatus: {
          kind: 'success',
          lineMessageId: 'line_msg_001' as never,
          sentAt: new Date(),
        },
      }),
    ).toThrow()
  })
})

describe('concludesDelivery（冪等性キーの配信を確定させるか）', () => {
  const logWith = (resultStatus: unknown) => LineDeliveryLogSchema.parse({ ...base, resultStatus })

  it('送信成功は配信を確定させる（同一キーで再送信しない）', () => {
    expect(
      concludesDelivery(
        logWith({ kind: 'success', lineMessageId: 'line_msg_001', sentAt: new Date() }),
      ),
    ).toBe(true)
  })

  it('送信スキップは理由によらず配信を確定させる（送らないと決めた事実が確定している）', () => {
    // 列挙をベタ書きせず schema から回す（スキップ理由が増えたら自動で対象に入る）
    for (const skipReason of DeliverySkipReasonSchema.options) {
      expect(
        concludesDelivery(logWith({ kind: 'skipped', skipReason, skippedAt: new Date() })),
      ).toBe(true)
    }
  })

  it('未達が確定した送信失敗だけが配信を確定させない（#441-A）', () => {
    // 再送信してよいのは「LINE に届いていないと断定できる失敗」だけ。
    // timeout は LINE 側が受理済みかもしれず、再送信すると金額入りの月次サマリが
    // 2 通届きうるため確定扱い。invalid_target は何度送っても直らないため確定扱い。
    const expected: Record<(typeof SendFailureReasonSchema.options)[number], boolean> = {
      line_api_failure: false,
      timeout: true,
      invalid_target: true,
    }
    for (const failureReason of SendFailureReasonSchema.options) {
      expect(
        concludesDelivery(logWith({ kind: 'failure', failureReason, failedAt: new Date() })),
      ).toBe(expected[failureReason])
    }
  })
})

describe('concludedDeliveryOf（確定ログの選択）', () => {
  const logWith = (resultStatus: unknown, deliveryLogId = base.deliveryLogId) =>
    LineDeliveryLogSchema.parse({ ...base, deliveryLogId, resultStatus })
  const succeeded = (id: string) =>
    logWith(
      { kind: 'success', lineMessageId: 'line_msg_001', sentAt: new Date() },
      id as typeof base.deliveryLogId,
    )
  const failed = logWith({
    kind: 'failure',
    failureReason: 'line_api_failure',
    failedAt: new Date(),
  })

  it('ログが 1 件も無ければ null（初回配信）', () => {
    expect(concludedDeliveryOf([])).toBeNull()
  })

  it('未達が確定した失敗だけなら null（再送信に進んでよい）', () => {
    expect(concludedDeliveryOf([failed, failed])).toBeNull()
  })

  it('確定ログがあればそれを返す（失敗が先に積まれていても拾える）', () => {
    const success = succeeded('01DG0000000000000000000002')
    expect(concludedDeliveryOf([failed, success])).toBe(success)
  })

  it('確定ログが 2 件あれば InvariantViolationError（二重配信済みを見逃さない）', () => {
    // DB の partial unique index をすり抜けた異常。黙って 1 件目を返すと、
    // 既に 2 通届いている事実が呼出し側から見えなくなる
    expect(() =>
      concludedDeliveryOf([
        succeeded('01DG0000000000000000000002'),
        succeeded('01DG0000000000000000000003'),
      ]),
    ).toThrow(InvariantViolationError)
  })
})

describe('deliveryLogOccurredAt（発生日時）', () => {
  const logWith = (resultStatus: unknown) => LineDeliveryLogSchema.parse({ ...base, resultStatus })
  const at = new Date('2026-07-01T12:34:56Z')

  it('3 つの終端それぞれの日時を取り出す（集約直下に送信日時を持たないため）', () => {
    expect(
      deliveryLogOccurredAt(
        logWith({ kind: 'success', lineMessageId: 'line_msg_001', sentAt: at }),
      ),
    ).toEqual(at)
    expect(
      deliveryLogOccurredAt(logWith({ kind: 'failure', failureReason: 'timeout', failedAt: at })),
    ).toEqual(at)
    expect(
      deliveryLogOccurredAt(
        logWith({ kind: 'skipped', skipReason: 'notification_disabled', skippedAt: at }),
      ),
    ).toEqual(at)
  })
})

describe('createLineDeliveryLog（終端状態からの組立）', () => {
  const common = CommonDeliveryMessageAttrsSchema.parse({
    deliveryMessageId: '01HZX3F2M9GQ4T8VWYJ5KNBC6D',
    target: { kind: 'shared_talk_room', talkRoomId: 'room_001' },
    content: { kind: 'plain_text', textBody: 'テスト本文' },
    purpose: 'test_message',
  })
  const deliveryLogId = DeliveryLogIdSchema.parse('01HZX3F2M9GQ4T8VWYJ5KNBC6E')
  const baseParams = { deliveryLogId, sentPayloadJson: '{"stub":true}', idempotencyKey: 'key-1' }

  it('sent → success（LINE message ID と送信完了日時を凍結）', () => {
    const message = DeliveryMessageSchema.parse({
      kind: 'sent',
      common,
      sentAt: new Date('2026-07-01T00:00:00Z'),
      lineMessageId: 'line-msg-1',
    }) as SentDeliveryMessage
    const log = createLineDeliveryLog({ ...baseParams, message })
    expect(log.resultStatus).toEqual({
      kind: 'success',
      lineMessageId: 'line-msg-1',
      sentAt: new Date('2026-07-01T00:00:00Z'),
    })
    expect(log.deliveryMessageId).toBe(common.deliveryMessageId)
    expect(log.sentPayloadJson).toBe('{"stub":true}')
  })

  it('failed → failure（失敗理由と失敗日時を凍結）', () => {
    const message = DeliveryMessageSchema.parse({
      kind: 'failed',
      common,
      failedAt: new Date('2026-07-01T00:00:00Z'),
      failureReason: 'timeout',
      retryState: 'retry_abandoned',
    }) as FailedDeliveryMessage
    const log = createLineDeliveryLog({ ...baseParams, message })
    expect(log.resultStatus).toEqual({
      kind: 'failure',
      failureReason: 'timeout',
      failedAt: new Date('2026-07-01T00:00:00Z'),
    })
  })

  it('skipped → skipped（スキップ理由とスキップ日時を凍結）', () => {
    const message = DeliveryMessageSchema.parse({
      kind: 'skipped',
      common,
      skippedAt: new Date('2026-07-01T00:00:00Z'),
      skipReason: 'notification_disabled',
    }) as SkippedDeliveryMessage
    const log = createLineDeliveryLog({ ...baseParams, message })
    expect(log.resultStatus).toEqual({
      kind: 'skipped',
      skipReason: 'notification_disabled',
      skippedAt: new Date('2026-07-01T00:00:00Z'),
    })
  })

  it('配信タイミング種別は配信用途から導出される（不整合な組合せを排除）', () => {
    const messageOf = (purpose: string, target: unknown) =>
      DeliveryMessageSchema.parse({
        kind: 'sent',
        common: { ...common, purpose, target },
        sentAt: new Date(),
        lineMessageId: 'line-msg-1',
      }) as SentDeliveryMessage
    const talkRoom = { kind: 'shared_talk_room', talkRoomId: 'room_001' }
    const dm = { kind: 'personal_dm', userId: 'user_honey' }
    const cases: [string, unknown, string][] = [
      ['test_message', talkRoom, 'test_send'],
      ['csv_import_reminder', talkRoom, 'reminder'],
      ['monthly_report_household_summary', talkRoom, 'csv_confirmation'],
      ['monthly_report_personal_summary', dm, 'csv_confirmation'],
      ['oauth_revocation_notice', dm, 'oauth_revocation_detected'],
    ]
    for (const [purpose, target, expected] of cases) {
      expect(
        createLineDeliveryLog({ ...baseParams, message: messageOf(purpose, target) }).timingKind,
      ).toBe(expected)
    }
  })
})
