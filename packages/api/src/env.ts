import type { UserId } from '@warimaru/domain'

export type AppEnv = {
  Variables: {
    viewerId: UserId
  }
}

/**
 * 本番判定の単一の情報源。
 * app.ts（認証ミドルウェア選択）と composition-root.ts（DB/モック選択）で
 * 判定基準が食い違うと、片方だけが本番扱いになる fail-open の窓が生まれるため、
 * トリム + 小文字化した正規化を両者で共有する。
 */
export function isProduction(nodeEnv: string | undefined = process.env['NODE_ENV']): boolean {
  return nodeEnv?.trim().toLowerCase() === 'production'
}
