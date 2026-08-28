/**
 * 許可リスト参照の使い回し（#533）と、取得できない間の縮退運転（#650）
 *
 * 許可リストは全要求の応答パスに乗るため、取得回数・上限時間・失敗の扱いを固定する。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AllowlistSchema, type Allowlist, type AllowlistQuery } from '@warimaru/domain'
import { createCachingAllowlistQuery } from '../src/caching-allowlist-query.js'

const ALLOWLIST: Allowlist = AllowlistSchema.parse({
  honeyLineUserId: 'user-honey-test',
  darlingLineUserId: 'user-darling-test',
})

const STALE_GRACE_MS = 30 * 60_000

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

/** 成功/失敗を切り替えられる AllowlistQuery。#650 の縮退運転シナリオの組み立てに使う */
function switchableQuery(reason = 'Parameter Store が未構成'): {
  query: AllowlistQuery
  fail: (v: boolean) => void
} {
  let shouldFail = false
  return {
    query: {
      fetch: () => (shouldFail ? Promise.reject(new Error(reason)) : Promise.resolve(ALLOWLIST)),
    },
    fail: (v: boolean) => {
      shouldFail = v
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('取得の失敗は次の要求で引き直す', async () => {
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

  it('健全なときは health() が healthy を返す', async () => {
    const { query } = countingQuery()
    const caching = createCachingAllowlistQuery(query)
    expect(caching.health()).toEqual({ status: 'healthy' })
    await caching.fetch()
    expect(caching.health()).toEqual({ status: 'healthy' })
  })

  describe('縮退運転（#650）', () => {
    it('猶予時間内なら、取得できなくなっても直近の内容で応答し続け、health() が degraded を返す', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { query, fail } = switchableQuery()
      let current = new Date('2026-08-24T00:00:00Z')
      const caching = createCachingAllowlistQuery(query, {
        ttlMs: 60_000,
        staleGraceMs: STALE_GRACE_MS,
        now: () => current,
      })
      expect(await caching.fetch()).toEqual(ALLOWLIST)

      fail(true)
      current = new Date('2026-08-24T00:20:00Z') // ttl 切れの後、猶予時間(30分)以内
      await expect(caching.fetch()).resolves.toEqual(ALLOWLIST)
      expect(caching.health()).toEqual({
        status: 'degraded',
        detail: expect.stringContaining('2026-08-24T00:20:00.000Z') as unknown as string,
      })
    })

    it('取得できなくなったことをログに残す（無言で縮退運転に入らない）', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { query, fail } = switchableQuery('Parameter Store が未構成')
      let current = new Date('2026-08-24T00:00:00Z')
      const caching = createCachingAllowlistQuery(query, {
        ttlMs: 60_000,
        staleGraceMs: STALE_GRACE_MS,
        now: () => current,
      })
      await caching.fetch()

      fail(true)
      current = new Date('2026-08-24T00:20:00Z')
      await caching.fetch()
      const logged = error.mock.calls.flat().join(' ')
      expect(logged).toContain('Parameter Store が未構成')
      expect(logged).not.toContain('user-honey-test')
      expect(logged).not.toContain('user-darling-test')
    })

    it('猶予時間ちょうどでは、まだ縮退運転を続ける（境界）', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { query, fail } = switchableQuery()
      let current = new Date('2026-08-24T00:00:00Z')
      const caching = createCachingAllowlistQuery(query, {
        ttlMs: 60_000,
        staleGraceMs: STALE_GRACE_MS,
        now: () => current,
      })
      await caching.fetch()

      fail(true)
      current = new Date('2026-08-24T00:30:00Z') // 猶予時間(30分)ちょうど
      await expect(caching.fetch()).resolves.toEqual(ALLOWLIST)
      expect(caching.health().status).toBe('degraded')
    })

    it('猶予時間を1ms過ぎると fail-closed に戻る（境界、否定形）', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { query, fail } = switchableQuery()
      let current = new Date('2026-08-24T00:00:00Z')
      const caching = createCachingAllowlistQuery(query, {
        ttlMs: 60_000,
        staleGraceMs: STALE_GRACE_MS,
        now: () => current,
      })
      await caching.fetch()

      fail(true)
      current = new Date('2026-08-24T00:30:00.001Z') // 猶予時間(30分)を1ms過ぎた
      await expect(caching.fetch()).rejects.toThrow()
      expect(caching.health().status).toBe('unavailable')
    })

    it('猶予時間を過ぎたら fail-closed に戻る（否定形）', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { query, fail } = switchableQuery('Parameter Store が未構成')
      let current = new Date('2026-08-24T00:00:00Z')
      const caching = createCachingAllowlistQuery(query, {
        ttlMs: 60_000,
        staleGraceMs: STALE_GRACE_MS,
        now: () => current,
      })
      await caching.fetch()

      fail(true)
      current = new Date('2026-08-24T00:31:00Z') // 猶予時間(30分)を過ぎた
      await expect(caching.fetch()).rejects.toThrow('Parameter Store が未構成')
      expect(caching.health().status).toBe('unavailable')
    })

    it('保持時間(ttlMs)が猶予時間より長くても、猶予を過ぎたら fail-closed に戻る（キャッシュ延長のクランプ、否定形）', async () => {
      // #650 のセキュリティレビューで検出: 縮退運転時に cached の有効期限を常に ttlMs 分だけ
      // 延長すると、ttlMs が猶予時間より長い設定では猶予を過ぎても cached が有効なままになり、
      // fail-closed に戻れなくなる回帰を防ぐ
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { query, fail } = switchableQuery()
      let current = new Date('2026-08-24T00:00:00Z')
      const caching = createCachingAllowlistQuery(query, {
        ttlMs: 10 * 60_000, // 猶予時間(30分)より長い保持時間
        staleGraceMs: STALE_GRACE_MS,
        now: () => current,
      })
      await caching.fetch()

      fail(true)
      current = new Date('2026-08-24T00:29:00Z') // 猶予期限(00:30:00)の1分前
      await expect(caching.fetch()).resolves.toEqual(ALLOWLIST) // 縮退運転に入る

      current = new Date('2026-08-24T00:33:00Z') // 猶予期限は過ぎたが、クランプが無ければ
      // cached はまだ 00:39:00 まで有効なままになってしまう
      await expect(caching.fetch()).rejects.toThrow()
      expect(caching.health().status).toBe('unavailable')
    })

    it('複数回の縮退運転を挟んでも、猶予の起点(直近の生取得成功時刻)は伸びない', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { query, fail } = switchableQuery()
      let current = new Date('2026-08-24T00:00:00Z')
      const caching = createCachingAllowlistQuery(query, {
        ttlMs: 5 * 60_000,
        staleGraceMs: STALE_GRACE_MS,
        now: () => current,
      })
      await caching.fetch() // t=0:00 に生取得成功

      fail(true)
      current = new Date('2026-08-24T00:10:00Z')
      await expect(caching.fetch()).resolves.toEqual(ALLOWLIST) // 1回目の縮退運転
      expect(caching.health()).toEqual({
        status: 'degraded',
        detail: expect.stringContaining('2026-08-24T00:10:00.000Z') as unknown as string,
      })

      current = new Date('2026-08-24T00:25:00Z')
      await expect(caching.fetch()).resolves.toEqual(ALLOWLIST) // 2回目の縮退運転
      // 起点(縮退運転に入った時刻)は最初の 00:10:00 のまま更新されない
      expect(caching.health()).toEqual({
        status: 'degraded',
        detail: expect.stringContaining('2026-08-24T00:10:00.000Z') as unknown as string,
      })

      current = new Date('2026-08-24T00:41:00Z') // 生取得成功(0:00)から30分(猶予)を過ぎた
      await expect(caching.fetch()).rejects.toThrow()
      expect(caching.health().status).toBe('unavailable')
    })

    it('直近の取得が一度も無ければ、猶予時間があっても fail-closed のまま（health() は unavailable）', async () => {
      const caching = createCachingAllowlistQuery(
        { fetch: () => Promise.reject(new Error('初回から取得できない')) },
        { staleGraceMs: STALE_GRACE_MS },
      )
      await expect(caching.fetch()).rejects.toThrow('初回から取得できない')
      expect(caching.health().status).toBe('unavailable')
    })

    it('猶予時間 0 を指定すると、直近の取得があっても即 fail-closed する', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { query, fail } = switchableQuery()
      let current = new Date('2026-08-24T00:00:00Z')
      const caching = createCachingAllowlistQuery(query, {
        ttlMs: 60_000,
        staleGraceMs: 0,
        now: () => current,
      })
      await caching.fetch()

      fail(true)
      current = new Date('2026-08-24T00:01:00Z')
      await expect(caching.fetch()).rejects.toThrow()
      expect(caching.health().status).toBe('unavailable')
    })

    it('応答が返らない相手（タイムアウト）で失敗した場合も縮退運転に入る', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      let hang = false
      let current = new Date('2026-08-24T00:00:00Z')
      const caching = createCachingAllowlistQuery(
        { fetch: () => (hang ? new Promise(() => undefined) : Promise.resolve(ALLOWLIST)) },
        { ttlMs: 60_000, timeoutMs: 10, staleGraceMs: STALE_GRACE_MS, now: () => current },
      )
      await caching.fetch()

      hang = true
      current = new Date('2026-08-24T00:20:00Z')
      await expect(caching.fetch()).resolves.toEqual(ALLOWLIST)
      expect(caching.health().status).toBe('degraded')
    })

    it('縮退運転から回復すると healthy に戻る', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { query, fail } = switchableQuery('一時的な取得失敗')
      let current = new Date('2026-08-24T00:00:00Z')
      const caching = createCachingAllowlistQuery(query, {
        ttlMs: 60_000,
        staleGraceMs: STALE_GRACE_MS,
        now: () => current,
      })
      await caching.fetch()
      fail(true)
      current = new Date('2026-08-24T00:20:00Z')
      await caching.fetch()
      expect(caching.health().status).toBe('degraded')

      fail(false)
      current = new Date('2026-08-24T00:21:00Z')
      await caching.fetch()
      expect(caching.health()).toEqual({ status: 'healthy' })
    })
  })
})
