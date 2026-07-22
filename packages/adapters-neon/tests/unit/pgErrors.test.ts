import { describe, it, expect } from 'vitest'
import { isUniqueViolation } from '../../src/pgErrors'

describe('isUniqueViolation', () => {
  it('トップレベルの code = 23505 を検知する（素の pg エラー）', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })

  it('cause.code = 23505 を検知する（drizzle ≥0.44 の DrizzleQueryError ラップ）', () => {
    const wrapped = new Error('Failed query')
    ;(wrapped as Error & { cause: unknown }).cause = { code: '23505' }
    expect(isUniqueViolation(wrapped)).toBe(true)
  })

  it('多段にラップされた cause チェーンの 23505 も検知する', () => {
    const inner = { code: '23505' }
    const mid = new Error('driver error')
    ;(mid as Error & { cause: unknown }).cause = inner
    const outer = new Error('Failed query')
    ;(outer as Error & { cause: unknown }).cause = mid
    expect(isUniqueViolation(outer)).toBe(true)
  })

  it('深さ上限を超える循環 cause でも無限ループせず false を返す', () => {
    const a = new Error('a') as Error & { cause: unknown }
    const b = new Error('b') as Error & { cause: unknown }
    a.cause = b
    b.cause = a // 循環参照
    expect(isUniqueViolation(a)).toBe(false)
  })

  it('unique violation 以外のコードは検知しない（例: FK 違反 23503）', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
    expect(isUniqueViolation({ cause: { code: '23503' } })).toBe(false)
  })

  it('null / 非オブジェクト / code なしは false', () => {
    expect(isUniqueViolation(null)).toBe(false)
    expect(isUniqueViolation(undefined)).toBe(false)
    expect(isUniqueViolation('23505')).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
  })
})
