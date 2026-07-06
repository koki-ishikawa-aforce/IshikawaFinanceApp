/**
 * Phase0 設定値集約（マスタ管理コンテキスト）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 * @see docs/domain/09-aggregates.md #21
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 *
 * kawasima: data Phase0設定値 = LINE_Channel設定 AND LINE_Webhook設定 AND 許可リスト設定
 *
 * 不変条件:
 *  - LINE_Channel設定・LINE_Webhook設定・許可リスト設定が揃って初めて運用可能
 *    （3 要素とも必須フィールドとして構造表現。部分投入状態は本集約の外に置く）
 *  - 設定値実体は Parameter Store（KMS）に保管され、本集約はパスのみ保持
 */
import { z } from 'zod'
import { Phase0ConfigIdSchema } from '../../shared/ids'
import { ParameterStorePathSchema } from '../../shared/value-objects/ParameterStorePath'

export const LineChannelConfigSchema = z.object({
  channelIdRef: ParameterStorePathSchema,
  channelSecretRef: ParameterStorePathSchema,
  channelAccessTokenRef: ParameterStorePathSchema,
  insertedAt: z.date(),
  officialAccountIdentifier: z.string().min(1),
})
export type LineChannelConfig = z.infer<typeof LineChannelConfigSchema>

export const LineWebhookConfigSchema = z.object({
  webhookUrl: z.string().min(1),
  lambdaBindingRef: z.string().min(1),
  configuredAt: z.date(),
})
export type LineWebhookConfig = z.infer<typeof LineWebhookConfigSchema>

export const AllowlistConfigSchema = z.object({
  honeyLineUserIdRef: ParameterStorePathSchema,
  darlingLineUserIdRef: ParameterStorePathSchema,
  insertedAt: z.date(),
})
export type AllowlistConfig = z.infer<typeof AllowlistConfigSchema>

export const Phase0ConfigSchema = z.object({
  phase0ConfigId: Phase0ConfigIdSchema,
  lineChannel: LineChannelConfigSchema,
  lineWebhook: LineWebhookConfigSchema,
  allowlist: AllowlistConfigSchema,
})
export type Phase0Config = z.infer<typeof Phase0ConfigSchema>
