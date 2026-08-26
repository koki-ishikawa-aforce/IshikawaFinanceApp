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

/**
 * multipart/form-data 等、`readJsonObjectBody` の対象外の読み取りを同じ方針で保護する。
 * パーサが投げる例外（生ボディの断片を含みうる）を、内容を含まない 400（Validation error）に写像する。
 *
 * `read` はリクエストボディのパース処理のみを渡すこと。ここでの catch は「クライアント入力が
 * パースできなかった」ことを前提にしており、それ以外の要因（ストリームエラーや実装バグ等）まで
 * 一律 400 に丸めると、error-handler の未マップ例外ログ（サーバ側の異常検知）を弱めてしまう。
 */
export async function readFormBody<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch {
    throw new ZodError([
      { code: 'custom', path: [], message: 'リクエストボディが不正な形式である' },
    ])
  }
}
