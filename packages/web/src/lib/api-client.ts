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

export async function apiFetch<T>(
  path: string,
  schema: { parse: (input: unknown) => T },
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: buildHeaders(),
  })
  if (!res.ok) {
    throw new ApiError(res.status, await res.text())
  }
  const json: unknown = await res.json()
  return schema.parse(json)
}

function extractMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed !== null && typeof parsed === 'object' && 'message' in parsed) {
      const message = (parsed as { message: unknown }).message
      if (typeof message === 'string') return message
    }
  } catch {
    // JSON でないボディはそのまま扱う
  }
  return body.length > 0 ? body : null
}

interface MutateOptions {
  method: 'POST' | 'PUT' | 'DELETE'
  body?: unknown
}

export async function apiMutate<T>(
  path: string,
  options: MutateOptions,
  schema: { parse: (input: unknown) => T },
): Promise<T> {
  const headers = buildHeaders()
  let requestBody: BodyInit | undefined
  if (options.body instanceof FormData) {
    requestBody = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    requestBody = JSON.stringify(options.body)
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: options.method,
    headers,
    ...(requestBody !== undefined ? { body: requestBody } : {}),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new ApiError(res.status, text)
  }
  const json: unknown = text.length > 0 ? JSON.parse(text) : null
  return schema.parse(json)
}
