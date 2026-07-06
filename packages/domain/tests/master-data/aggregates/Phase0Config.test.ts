import { describe, it, expect } from 'vitest'
import { Phase0ConfigSchema } from '../../../src/master-data/aggregates/Phase0Config'

const lineChannel = {
  channelIdRef: '/warimaru/line/channel_id' as never,
  channelSecretRef: '/warimaru/line/channel_secret' as never,
  channelAccessTokenRef: '/warimaru/line/channel_access_token' as never,
  insertedAt: new Date(),
  officialAccountIdentifier: '@warimaru',
}
const lineWebhook = {
  webhookUrl: 'https://api.warimaru.example.com/webhook',
  lambdaBindingRef: 'warimaru-webhook-handler',
  configuredAt: new Date(),
}
const allowlist = {
  honeyLineUserIdRef: '/warimaru/allowlist/husband_line_user_id' as never,
  darlingLineUserIdRef: '/warimaru/allowlist/wife_line_user_id' as never,
  insertedAt: new Date(),
}

describe('Phase0Config 集約', () => {
  it('3 要素（Channel / Webhook / 許可リスト）が揃えば parse 成功', () => {
    expect(() =>
      Phase0ConfigSchema.parse({
        phase0ConfigId: 'p0_001' as never,
        lineChannel,
        lineWebhook,
        allowlist,
      }),
    ).not.toThrow()
  })

  it('許可リスト設定が欠けると parse 失敗（三要素の整合性）', () => {
    expect(() =>
      Phase0ConfigSchema.parse({
        phase0ConfigId: 'p0_001' as never,
        lineChannel,
        lineWebhook,
      }),
    ).toThrow()
  })
})
