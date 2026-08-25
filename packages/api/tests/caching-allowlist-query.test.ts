/**
 * 許可リスト参照の使い回し（#533）
 *
 * 許可リストは全要求の応答パスに乗るため、取得回数・上限時間・失敗の扱いを固定する。
 */
import { describe, it, expect } from 'vitest'
import { AllowlistSchema, type Allowlist, type AllowlistQuery } from '@warimaru/domain'
import { createCachingAllowlistQuery } from '../src/caching-allowlist-query.js'

const ALLOWLIST: Allowlist = AllowlistSchema.parse({
  honeyLineUserId: 'user-honey-test',
  darlingLineUserId: 'user-darling-test',
})

function countingQuery(): { query: AllowlistQuery; count: () => number } {
  let count = 0
  return {
    query: {
      fetch: () => {
        count += 1
        return Promise.resolve(ALLOWLIST)
      },
    },
    count: () => count,
  }
}

describe('createCachingAllowlistQuery', () => {
  it('保持時間の間は取得を繰り返さない', async () => {
    const { query, count } = countingQuery()
    const now = new Date('2026-08-24T00:00:00Z')
    const caching = createCachingAllowlistQuery(query, { ttlMs: 60_000, now: () => now })
    expect(await caching.fetch()).toEqual(ALLOWLIST)
    expect(await caching.fetch()).toEqual(ALLOWLIST)
    expect(count()).toBe(1)
  })

  it('保持時間ちょうどで取得し直す（境界）', async () => {
    const { query, count } = countingQuery()
    let current = new Date('2026-08-24T00:00:00Z')
    const caching = createCachingAllowlistQuery(query, { ttlMs: 60_000, now: () => current })
    await caching.fetch()
    current = new Date('2026-08-24T00:01:00Z')
    await caching.fetch()
    expect(count()).toBe(2)
  })

  it('保持時間 0 なら毎回取得する', async () => {
    const { query, count } = countingQuery()
    const now = new Date('2026-08-24T00:00:00Z')
    const caching = createCachingAllowlistQuery(query, { ttlMs: 0, now: () => now })
    await caching.fetch()
    await caching.fetch()
    expect(count()).toBe(2)
  })

  it('同時に届いた要求で取得を重複させない', async () => {
    const { query, count } = countingQuery()
    const now = new Date('2026-08-24T00:00:00Z')
    const caching = createCachingAllowlistQuery(query, { ttlMs: 60_000, now: () => now })
    const results = await Promise.all([caching.fetch(), caching.fetch(), caching.fetch()])
    expect(results).toEqual([ALLOWLIST, ALLOWLIST, ALLOWLIST])
    expect(count()).toBe(1)
  })

  it('取得の失敗は覚え込まず、次の要求で引き直す', async () => {
    let shouldFail = true
    const caching = createCachingAllowlistQuery({
      fetch: () =>
        shouldFail ? Promise.reject(new Error('一時的な取得失敗')) : Promise.resolve(ALLOWLIST),
    })
    await expect(caching.fetch()).rejects.toThrow('一時的な取得失敗')
    shouldFail = false
    expect(await caching.fetch()).toEqual(ALLOWLIST)
  })

  it('取得を共有した同時要求は全て失敗し、その後の要求で回復する（否定形）', async () => {
    let shouldFail = true
    const caching = createCachingAllowlistQuery({
      fetch: () =>
        shouldFail ? Promise.reject(new Error('一時的な取得失敗')) : Promise.resolve(ALLOWLIST),
    })
    const settled = await Promise.allSettled([caching.fetch(), caching.fetch(), caching.fetch()])
    expect(settled.map(r => r.status)).toEqual(['rejected', 'rejected', 'rejected'])
    shouldFail = false
    expect(await caching.fetch()).toEqual(ALLOWLIST)
  })

  it('応答が返らない相手には上限時間で見切りをつける（待ち続けない）', async () => {
    const caching = createCachingAllowlistQuery(
      { fetch: () => new Promise(() => undefined) },
      {
        timeoutMs: 10,
      },
    )
    await expect(caching.fetch()).rejects.toMatchObject({ name: 'TimeoutError' })
    // 上限時間で決着した取得を掴んだままにしない（次の要求は引き直せる）
    await expect(caching.fetch()).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
