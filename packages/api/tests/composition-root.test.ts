import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeps, createMockDeps } from '../src/composition-root.js'

describe('createDeps モックフォールバックの環境ガード (#47)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('本番環境で DATABASE_URL が未設定なら起動エラーにする（モックへ黙ってフォールバックしない）', async () => {
    await expect(createDeps({ NODE_ENV: 'production' })).rejects.toThrowError(
      /DATABASE_URL is required/,
    )
  })

  it('開発環境では DATABASE_URL 未設定でもモック deps を返す（警告ログ付き）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const deps = await createDeps({ NODE_ENV: 'development' })

    expect(deps.dashboardQuery).toBeDefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('development only'))
  })

  it('NODE_ENV 未設定は開発環境扱い（既存テストの createDeps({}) 挙動を維持）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(createDeps({})).resolves.toBeDefined()
  })

  it('本番環境でも DATABASE_URL が設定されていればガードは発火しない（実 deps を構築）', async () => {
    // モック合成に落ちたときも dashboardQuery は生えるため、それだけでは実 deps の証明にならない。
    // モック経路でしか出ない警告が出ていないことを対にして見る（#349 で合成が2関数に分かれたため）。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const deps = await createDeps({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warimaru',
      // 本番では CORS_ALLOWED_ORIGINS も必須のため、DATABASE_URL ガード単体を見るには併せて渡す (#309)
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net',
    })

    expect(deps.dashboardQuery).toBeDefined()
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('development only'))
  })

  // createMockDeps は createDeps 経由だけでなくテストのアプリ組み立てからも直接呼ばれる (#349)。
  // ガードが createDeps 側にあると、直接呼び出しが本番設定のまま素通りする窓が開く。
  it('モック合成を直接呼んでも本番環境なら起動エラーにする', () => {
    expect(() => createMockDeps({ NODE_ENV: 'production' })).toThrowError(
      /DATABASE_URL is required/,
    )
  })
})

describe('DB ドライバ選択の配線 (#323)', () => {
  const NEON_URL = 'postgresql://user:pass@ep-cool-block-123.ap-northeast-1.aws.neon.tech/warimaru'

  it('本番で DATABASE_DRIVER=node-postgres を指定したら起動エラーにする（ローカル向けドライバへ倒さない）', async () => {
    await expect(
      createDeps({
        NODE_ENV: 'production',
        DATABASE_URL: NEON_URL,
        DATABASE_DRIVER: 'node-postgres',
        CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net',
      }),
    ).rejects.toThrowError(/not allowed in production/)
  })

  it('未知の DATABASE_DRIVER は起動エラーにする（既定へ黙って倒さない）', async () => {
    await expect(
      createDeps({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/warimaru_dev',
        DATABASE_DRIVER: 'sqlite',
      }),
    ).rejects.toThrowError(/DATABASE_DRIVER must be one of/)
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

  it('開発環境で CORS_ALLOWED_ORIGINS が未設定なら localhost:3000 を既定にする', async () => {
    silenceWarn()

    expect((await createDeps({})).allowedOrigins).toEqual(['http://localhost:3000'])
  })

  it('カンマ区切りで複数のオリジンを指定できる（前後の空白は無視する）', async () => {
    silenceWarn()

    const deps = await createDeps({
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net , https://warimaru.example.com',
    })

    expect(deps.allowedOrigins).toEqual([
      'https://example.cloudfront.net',
      'https://warimaru.example.com',
    ])
  })

  it('空文字・カンマのみの指定は未設定と同じ扱いにする（開発環境では既定値）', async () => {
    silenceWarn()

    expect((await createDeps({ CORS_ALLOWED_ORIGINS: ' , ' })).allowedOrigins).toEqual([
      'http://localhost:3000',
    ])
  })

  it('本番環境で CORS_ALLOWED_ORIGINS が未設定なら起動エラーにする（localhost へ黙って倒さない）', async () => {
    await expect(
      createDeps({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warimaru',
      }),
    ).rejects.toThrowError(/CORS_ALLOWED_ORIGINS is required/)
  })

  it('本番環境で空文字を渡した場合も起動エラーにする', async () => {
    await expect(
      createDeps({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/warimaru',
        CORS_ALLOWED_ORIGINS: '   ',
      }),
    ).rejects.toThrowError(/CORS_ALLOWED_ORIGINS is required/)
  })

  it('本番環境で CORS_ALLOWED_ORIGINS が設定されていれば起動できる', async () => {
    const deps = await createDeps({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warimaru',
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net',
    })

    expect(deps.allowedOrigins).toEqual(['https://example.cloudfront.net'])
  })
})
