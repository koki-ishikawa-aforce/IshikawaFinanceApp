import { describe, it, expect } from 'vitest'
import type { DeliveryContent, DeliveryTarget } from '@warimaru/domain'
import { DeliveryContentSchema, DeliveryTargetSchema } from '@warimaru/domain'
import { createLineMessagingGateway } from '../../src/notification/line-messaging-gateway.js'

const talkRoomTarget: DeliveryTarget = DeliveryTargetSchema.parse({
  kind: 'shared_talk_room',
  talkRoomId: 'room_001',
})
const dmTarget: DeliveryTarget = DeliveryTargetSchema.parse({
  kind: 'personal_dm',
  userId: 'user_honey',
})

function stubFetch(response: { status: number; body?: unknown }): {
  fetchImpl: typeof fetch
  requests: { url: string; init: RequestInit }[]
} {
  const requests: { url: string; init: RequestInit }[] = []
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} })
    return Promise.resolve(
      new Response(JSON.stringify(response.body ?? {}), { status: response.status }),
    )
  }) as typeof fetch
  return { fetchImpl, requests }
}

describe('createLineMessagingGateway', () => {
  it('プレーンテキストを text メッセージへ翻訳し、Bearer トークンで push する', async () => {
    const { fetchImpl, requests } = stubFetch({
      status: 200,
      body: { sentMessages: [{ id: 'line-message-id-1' }] },
    })
    const gateway = createLineMessagingGateway({
      resolveChannelAccessToken: () => Promise.resolve('token-123'),
      fetchImpl,
    })
    const content: DeliveryContent = DeliveryContentSchema.parse({
      kind: 'plain_text',
      textBody: 'CSV 取込をお願いします',
      linkUrl: 'https://example.com/import',
    })
    const outcome = await gateway.sendPush(talkRoomTarget, content)

    expect(outcome.result).toEqual({ kind: 'success', lineMessageId: 'line-message-id-1' })
    const request = requests[0]
    expect(request?.url).toBe('https://api.line.me/v2/bot/message/push')
    expect(new Headers(request?.init.headers).get('Authorization')).toBe('Bearer token-123')
    const payload = JSON.parse(String(request?.init.body)) as {
      to: string
      messages: { type: string; text?: string }[]
    }
    expect(payload.to).toBe('room_001')
    expect(payload.messages[0]).toEqual({
      type: 'text',
      text: 'CSV 取込をお願いします\nhttps://example.com/import',
    })
    expect(outcome.sentPayloadJson).toBe(String(request?.init.body))
  })

  it('Flex Message を flex メッセージ（altText 付き）へ翻訳する', async () => {
    const { fetchImpl, requests } = stubFetch({ status: 200, body: { sentMessages: [] } })
    const gateway = createLineMessagingGateway({
      resolveChannelAccessToken: () => Promise.resolve('token-123'),
      fetchImpl,
    })
    const content: DeliveryContent = DeliveryContentSchema.parse({
      kind: 'flex_message',
      flexPayloadJson: '{"type":"bubble"}',
      linkUrl: 'https://example.com/report',
    })
    const outcome = await gateway.sendPush(dmTarget, content)

    expect(outcome.result.kind).toBe('success')
    const payload = JSON.parse(String(requests[0]?.init.body)) as {
      to: string
      messages: { type: string; altText?: string; contents?: unknown }[]
    }
    expect(payload.to).toBe('user_honey')
    expect(payload.messages[0]?.type).toBe('flex')
    expect(payload.messages[0]?.altText).toBeTruthy()
    expect(payload.messages[0]?.contents).toEqual({ type: 'bubble' })
  })

  it('HTTP 400 は invalid_target、その他のエラーは line_api_failure へ翻訳する', async () => {
    for (const [status, expected] of [
      [400, 'invalid_target'],
      [401, 'line_api_failure'],
      [500, 'line_api_failure'],
    ] as const) {
      const { fetchImpl } = stubFetch({ status })
      const gateway = createLineMessagingGateway({
        resolveChannelAccessToken: () => Promise.resolve('token-123'),
        fetchImpl,
      })
      const outcome = await gateway.sendPush(
        talkRoomTarget,
        DeliveryContentSchema.parse({ kind: 'plain_text', textBody: 'x' }),
      )
      expect(outcome.result.kind).toBe('failure')
      if (outcome.result.kind === 'failure') {
        expect(outcome.result.failureReason).toBe(expected)
      }
    }
  })

  it('タイムアウトは timeout へ翻訳する', async () => {
    const fetchImpl = (() => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      return Promise.reject(error)
    }) as typeof fetch
    const gateway = createLineMessagingGateway({
      resolveChannelAccessToken: () => Promise.resolve('token-123'),
      fetchImpl,
    })
    const outcome = await gateway.sendPush(
      talkRoomTarget,
      DeliveryContentSchema.parse({ kind: 'plain_text', textBody: 'x' }),
    )
    expect(outcome.result.kind).toBe('failure')
    if (outcome.result.kind === 'failure') {
      expect(outcome.result.failureReason).toBe('timeout')
    }
  })

  it('トークン解決失敗は line_api_failure（payload は凍結用に返す）', async () => {
    const gateway = createLineMessagingGateway({
      resolveChannelAccessToken: () => Promise.reject(new Error('Phase0Config not found')),
    })
    const outcome = await gateway.sendPush(
      talkRoomTarget,
      DeliveryContentSchema.parse({ kind: 'plain_text', textBody: 'x' }),
    )
    expect(outcome.result.kind).toBe('failure')
    if (outcome.result.kind === 'failure') {
      expect(outcome.result.failureReason).toBe('line_api_failure')
    }
    expect(outcome.sentPayloadJson).toContain('room_001')
  })
})
