/**
 * 本番判定の単一の情報源。
 *
 * DB ドライバ選択（client.ts）・認証ミドルウェア選択（api の app.ts）・
 * モックフォールバック（api の composition-root.ts）・seed スクリプトで
 * 判定基準が食い違うと、片方だけが本番扱いになる fail-open の窓が生まれる。
 * トリム + 小文字化した正規化をここに一本化し、各所はこの関数を呼ぶ。
 */
export function isProductionNodeEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv?.trim().toLowerCase() === 'production'
}
