import { isProductionNodeEnv } from '@warimaru/adapters-neon'
import type { UserId } from '@warimaru/domain'

export type AppEnv = {
  Variables: {
    viewerId: UserId
  }
}

/**
 * 本番判定。app.ts（認証ミドルウェア選択）と composition-root.ts（DB/モック選択）が共有する。
 * 判定基準が食い違うと片方だけが本番扱いになる fail-open の窓が生まれるため、
 * 正規化そのものは adapters-neon の `isProductionNodeEnv`（DB ドライバ選択と seed も使う）に一本化する。
 */
export function isProduction(nodeEnv: string | undefined = process.env['NODE_ENV']): boolean {
  return isProductionNodeEnv(nodeEnv)
}
