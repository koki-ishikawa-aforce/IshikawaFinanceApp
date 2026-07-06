/**
 * PostgreSQL エラーの判定ヘルパ
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §2.2
 *
 * unique violation (23505) は adapter が InvariantViolationError へ翻訳する。
 * drizzle-orm ≥0.44 はドライバエラーを DrizzleQueryError でラップし、
 * 元の pg / Neon エラーは cause に載るため、エラー本体と cause の両方を見る。
 */
const UNIQUE_VIOLATION = '23505'

function hasCode(e: unknown, code: string): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === code
  )
}

export function isUniqueViolation(e: unknown): boolean {
  if (hasCode(e, UNIQUE_VIOLATION)) return true
  if (typeof e === 'object' && e !== null && 'cause' in e) {
    return hasCode((e as { cause: unknown }).cause, UNIQUE_VIOLATION)
  }
  return false
}
