const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
const DEFAULT_USER_ID = process.env['NEXT_PUBLIC_USER_ID'] ?? 'U_DARLING_DEV'

export async function apiFetch<T>(path: string, schema: { parse: (input: unknown) => T }): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-User-Id': DEFAULT_USER_ID },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API error ${res.status}: ${body}`)
  }
  const json: unknown = await res.json()
  return schema.parse(json)
}
