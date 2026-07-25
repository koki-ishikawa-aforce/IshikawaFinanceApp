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
      // 本番では CORS_ALLOWED_ORIGINS も必須のため、DATABASE_URL ガード単体を見るには併せて渡す (#309)
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net',
    })

    expect(deps.dashboardQuery).toBeDefined()
  })
})

describe('CORS 許可オリジンの解決 (#309)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** モックフォールバックの警告で出力が埋まらないように黙らせる */
  function silenceWarn(): void {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  }

  it('開発環境で CORS_ALLOWED_ORIGINS が未設定なら localhost:3000 を既定にする', () => {
    silenceWarn()

    expect(createDeps({}).allowedOrigins).toEqual(['http://localhost:3000'])
  })

  it('カンマ区切りで複数のオリジンを指定できる（前後の空白は無視する）', () => {
    silenceWarn()

    const deps = createDeps({
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net , https://warimaru.example.com',
    })

    expect(deps.allowedOrigins).toEqual([
      'https://example.cloudfront.net',
      'https://warimaru.example.com',
    ])
  })

  it('空文字・カンマのみの指定は未設定と同じ扱いにする（開発環境では既定値）', () => {
    silenceWarn()

    expect(createDeps({ CORS_ALLOWED_ORIGINS: ' , ' }).allowedOrigins).toEqual([
      'http://localhost:3000',
    ])
  })

  it('本番環境で CORS_ALLOWED_ORIGINS が未設定なら起動エラーにする（localhost へ黙って倒さない）', () => {
    expect(() =>
      createDeps({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warimaru',
      }),
    ).toThrowError(/CORS_ALLOWED_ORIGINS is required/)
  })

  it('本番環境で空文字を渡した場合も起動エラーにする', () => {
    expect(() =>
      createDeps({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warimaru',
        CORS_ALLOWED_ORIGINS: '   ',
      }),
    ).toThrowError(/CORS_ALLOWED_ORIGINS is required/)
  })

  it('本番環境で CORS_ALLOWED_ORIGINS が設定されていれば起動できる', () => {
    const deps = createDeps({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warimaru',
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net',
    })

    expect(deps.allowedOrigins).toEqual(['https://example.cloudfront.net'])
  })
})
