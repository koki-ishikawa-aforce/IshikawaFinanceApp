import { ZodError } from 'zod'

/**
 * リクエストボディ文字列を JSON として読む。空ボディは `{}` として扱う。
 *
 * 不正な JSON（クライアント起因のエラー）を `JSON.parse` の `SyntaxError` のまま
 * throw すると error-handler で未マップとなり 500 に落ちる。ここで `ZodError` に
 * 写像し、他の入力検証エラーと同じ 400（Validation error）として返す。
 */
export function readJsonObjectBody(rawBody: string): unknown {
  if (rawBody.length === 0) return {}
  try {
    return JSON.parse(rawBody)
  } catch {
    throw new ZodError([
      { code: 'custom', path: [], message: 'リクエストボディが不正な JSON である' },
    ])
  }
}
