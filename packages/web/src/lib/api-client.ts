import { isLiffEnabled, getIdToken } from '@/lib/liff'

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
const DEV_USER_ID = process.env['NEXT_PUBLIC_USER_ID'] ?? 'U_DARLING_DEV'

function buildHeaders(): Record<string, string> {
  if (isLiffEnabled()) {
    const token = getIdToken()
    if (token) {
      return { Authorization: `Bearer ${token}` }
    }
  }
  return { 'X-User-Id': DEV_USER_ID }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(extractMessage(body) ?? `API error ${status}`)
    this.name = 'ApiError'
  }
}

/**
 * 通信そのものが成立しなかったときの共通文言。
 *
 * LIFF の WebView は電波状況が不安定な前提のため(`docs/design/usability.md` §7-3)、
 * 原因の切り分け(圏外・トンネル・機内モード)ではなく「電波の良い場所でやり直す」という
 * 次の行動だけを示す。応答が返らなかったのか届かなかったのかは利用者には区別できない。
 */
export const NETWORK_ERROR_MESSAGE =
  '通信できませんでした。電波の良い場所で、もう一度お試しください。'

/**
 * サーバーに届かなかった / 応答が返らなかった失敗。
 *
 * サーバーが返したエラー(`ApiError`)と区別する。`message` は全画面で同じ文言にしてあり、
 * `{error.message}` をそのまま出している画面でも通信の失敗として伝わる。
 */
export class NetworkError extends Error {
  /**
   * @param kind 届かなかった(`unreachable`)のか、応答が返らなかった(`timeout`)のか。
   *   利用者向けの文言は §7-7 の決めごとにより両者で同じにするため、これは画面に出さない。
   *   原因調査(「遅い」のか「切れている」のか)を分けるための区別として持つ
   */
  constructor(readonly kind: 'unreachable' | 'timeout') {
    super(NETWORK_ERROR_MESSAGE)
    this.name = 'NetworkError'
  }
}

/**
 * 通常のリクエストの打ち切り時間。
 *
 * 応答が返らないまま待ち続けると、画面は操作中の表示(「保存中...」等)のまま固まり、
 * 利用者からは「押したのに何も起きない」に見える。待たせるより失敗として見せる。
 */
export const DEFAULT_TIMEOUT_MS = 15_000

/**
 * 明細ファイルのアップロードの打ち切り時間。
 *
 * PDF はサーバー側で変換してから応答が返り、その変換自体に最大 300 秒かかりうる
 * (`packages/api/src/pdf-conversion/AnthropicPdfToCsvConverter.ts` の `timeoutMs`)。
 * これより短く打ち切ると、サーバーでは取込が成立しているのに画面だけ失敗になるため、
 * 変換の上限に余裕を足した値にする。
 */
export const UPLOAD_TIMEOUT_MS = 330_000

/**
 * 応答も本文の読み取りも制限時間内に終わらせ、通信の失敗を `NetworkError` に正規化する。
 *
 * 本文の読み取り(`res.json()` / `res.text()`)まで同じ制限時間に含める。ヘッダだけ返って
 * 本文が来ない接続で、打ち切りが効かなくなるのを防ぐため。
 */
async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await run(controller.signal)
  } catch (e) {
    if (timedOut) throw new NetworkError('timeout')
    // fetch が到達不能(オフライン・名前解決失敗・接続断)で投げるのは TypeError。
    // ApiError・スキーマ検証エラーはそのまま呼び出し側へ通す
    if (e instanceof TypeError) throw new NetworkError('unreachable')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 通信の失敗なら共通文言、それ以外(サーバーが返したエラー)なら画面ごとの文言を返す。
 *
 * 「〜の取得に失敗しました」だけでは、電波が届いていないのか不具合なのかが分からず、
 * 利用者が次に何をすればよいか決められない(`docs/design/usability.md` §7-7)。
 */
export function describeRequestFailure(error: unknown, fallback: string): string {
  return error instanceof NetworkError ? error.message : fallback
}

export async function apiFetch<T>(
  path: string,
  schema: { parse: (input: unknown) => T },
): Promise<T> {
  // モック起動モード（NEXT_PUBLIC_MOCK=1）。条件を直接 if に書くことで、
  // 通常ビルドでは process.env の畳み込みにより if(false) となり、
  // この分岐と動的 import される src/mocks/* チャンクがデッドコード除去される。
  if (process.env.NEXT_PUBLIC_MOCK === '1') {
    const { resolveMock, MockErrorResponse, MockNotFoundError } = await import('@/mocks/resolve')
    try {
      return schema.parse(resolveMock('GET', path))
    } catch (err) {
      if (err instanceof MockErrorResponse) throw new ApiError(err.status, err.body)
      if (err instanceof MockNotFoundError) throw new ApiError(err.status, err.message)
      throw err
    }
  }
  // スキーマ検証は打ち切りの外で行う。中に入れると、検証で投げた例外まで
  // 通信の失敗として拾ってしまい、サーバーの応答の不整合が「通信できませんでした」に化ける
  const json = await withTimeout(DEFAULT_TIMEOUT_MS, async signal => {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: buildHeaders(),
      signal,
    })
    if (!res.ok) {
      throw new ApiError(res.status, await res.text())
    }
    return (await res.json()) as unknown
  })
  return schema.parse(json)
}

/**
 * サーバー(`packages/api` の errorHandler)が返すエラー応答は `{ error: "..." }` の形。
 * `message` は現在どの応答も使わないが、将来の応答形式や外部由来のボディにも備えて残す
 * (この備え自体は `__tests__/api-client.test.ts` の「error が無ければ message」ケースで検証する)。
 */
function extractMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed !== null && typeof parsed === 'object') {
      for (const key of ['error', 'message'] as const) {
        if (key in parsed) {
          const value = (parsed as Record<string, unknown>)[key]
          if (typeof value === 'string') return value
        }
      }
    }
  } catch {
    // JSON でないボディはそのまま扱う
  }
  return body.length > 0 ? body : null
}

interface MutateOptions {
  method: 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  /** 打ち切りまでの時間。既定より長くかかる要求(明細アップロード)だけ指定する */
  timeoutMs?: number
}

export async function apiMutate<T>(
  path: string,
  options: MutateOptions,
  schema: { parse: (input: unknown) => T },
): Promise<T> {
  if (process.env.NEXT_PUBLIC_MOCK === '1') {
    const { resolveMock, MockErrorResponse, MockNotFoundError } = await import('@/mocks/resolve')
    try {
      return schema.parse(resolveMock(options.method, path))
    } catch (err) {
      if (err instanceof MockErrorResponse) throw new ApiError(err.status, err.body)
      if (err instanceof MockNotFoundError) throw new ApiError(err.status, err.message)
      throw err
    }
  }
  const headers = buildHeaders()
  let requestBody: BodyInit | undefined
  if (options.body instanceof FormData) {
    requestBody = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    requestBody = JSON.stringify(options.body)
  }
  const json = await withTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, async signal => {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: options.method,
      headers,
      signal,
      ...(requestBody !== undefined ? { body: requestBody } : {}),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new ApiError(res.status, text)
    }
    return (text.length > 0 ? JSON.parse(text) : null) as unknown
  })
  return schema.parse(json)
}
