import { describe, it, expect } from 'vitest'
import { DeliveryContentSchema } from '../../../src/notification-delivery/value-objects/DeliveryContent'

describe('DeliveryContent 値オブジェクト', () => {
  it('Flex Message はリンク URL 付きで parse 成功', () => {
    expect(() =>
      DeliveryContentSchema.parse({
        kind: 'flex_message',
        flexPayloadJson: '{"type":"flex"}',
        linkUrl: 'https://example.com/report/2026-07',
      }),
    ).not.toThrow()
  })

  it('Flex Message のリンク URL が空文字なら parse 失敗', () => {
    expect(() =>
      DeliveryContentSchema.parse({
        kind: 'flex_message',
        flexPayloadJson: '{"type":"flex"}',
        linkUrl: '',
      }),
    ).toThrow()
  })

  it('プレーンテキストはリンク URL 省略可', () => {
    expect(() =>
      DeliveryContentSchema.parse({ kind: 'plain_text', textBody: 'リマインド' }),
    ).not.toThrow()
  })
})
