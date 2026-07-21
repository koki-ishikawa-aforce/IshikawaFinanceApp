import { isLiffEnabled, getIdToken } from '@/lib/liff'

const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
const DEV_USER_ID = process.env['NEXT_PUBLIC_USER_ID'] ?? 'U_DARLING_DEV'

function buildHeaders(): HeadersInit {
  if (isLiffEnabled()) {
    const token = getIdToken()
    if (token) {
      return { Authorization: `Bearer ${token}` }
    }
  }
  return { 'X-User-Id': DEV_USER_ID }
}

export async function apiFetch<T>(path: string, schema: { parse: (input: unknown) => T }): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: buildHeaders(),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API error ${res.status}: ${body}`)
  }
  const json: unknown = await res.json()
  return schema.parse(json)
}
