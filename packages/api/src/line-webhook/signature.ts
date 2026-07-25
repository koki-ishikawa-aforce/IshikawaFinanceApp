/**
 * LINE Webhook 署名検証（`x-line-signature`）
 * @see docs/domain/03-open-questions.md OQ-55 ④
 *
 * LINE プラットフォームは Webhook リクエストの本文を Channel Secret を鍵とした
 * HMAC-SHA256 で署名し、Base64 で `x-line-signature` ヘッダーに載せる。
 * Webhook ルートは LIFF 認証（`/api/*`）の外にあるため、送信元の真正性は
 * この検証だけが担保する（検証を通らないリクエストは一切処理しない）。
 *
 * 検証は**受信した生バイト列**に対して行う。JSON をパースして再直列化した文字列は
 * キー順・空白・エスケープが変わりうるため、署名が一致しなくなる。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * `x-line-signature` を検証する。署名が一致するときだけ true を返す。
 *
 * 比較は `timingSafeEqual`（一致するバイト数を漏らさない比較）で行い、
 * 署名の推測に使える実行時間の差を作らない。
 */
export function verifyLineSignature(
  rawBody: Uint8Array,
  signature: string,
  channelSecret: string,
): boolean {
  if (signature.length === 0 || channelSecret.length === 0) return false
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest()
  // Base64 として不正な文字は Buffer.from が読み飛ばすため、長さ不一致で弾く
  // （timingSafeEqual は長さが違うと例外を投げるので、比較前に必ず確認する）
  const actual = Buffer.from(signature, 'base64')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}
