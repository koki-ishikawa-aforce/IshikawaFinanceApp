import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeps } from '../src/composition-root.js'

describe('createDeps モックフォールバックの環境ガード (#47)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('本番環境で DATABASE_URL が未設定なら起動エラーにする（モックへ黙ってフォールバックしない）', () => {
    expect(() => createDeps({ NODE_ENV: 'production' })).toThrowError(/DATABASE_URL is required/)
  })

  it('開発環境では DATABASE_URL 未設定でもモック deps を返す（警告ログ付き）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const deps = createDeps({ NODE_ENV: 'development' })

    expect(deps.dashboardQuery).toBeDefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('development only'))
  })

  it('NODE_ENV 未設定は開発環境扱い（既存テストの createDeps({}) 挙動を維持）', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(() => createDeps({})).not.toThrow()
  })

  it('本番環境でも DATABASE_URL が設定されていればガードは発火しない（実 deps を構築）', () => {
    const deps = createDeps({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warimaru',
    })

    expect(deps.dashboardQuery).toBeDefined()
  })
})
