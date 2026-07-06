/**
 * AWS Parameter Store パス値オブジェクト
 * @see docs/domain/08h-ul-マスタ管理.md §1
 *
 * シークレット実体は Parameter Store（KMS）に保管され、ドメインはパスのみ保持する。
 * オンボーディング・認証（Gmail OAuth トークン参照）/ マスタ管理（Phase0 設定値）/
 * 通知配信（Channel Access Token 参照）で共用。
 */
import { z } from 'zod'

export const ParameterStorePathSchema = z.string().min(1).brand<'ParameterStorePath'>()
export type ParameterStorePath = z.infer<typeof ParameterStorePathSchema>
