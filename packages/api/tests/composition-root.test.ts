import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  compositionEnvFromEnvironment,
  createDeps,
  createMockDeps,
} from '../src/composition-root.js'

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

describe('Deep Link の起点 URL の解決 (#389)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** モックフォールバック・WEB_BASE_URL 未設定の警告で出力が埋まらないように黙らせる */
  function silenceWarn(): void {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  }

  it('WEB_BASE_URL が設定されていればそれを使う', async () => {
    silenceWarn()
    const deps = await createDeps({
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net',
      WEB_BASE_URL: 'https://liff.line.me/1234567890-abcdefgh',
    })

    expect(deps.webBaseUrl).toBe('https://liff.line.me/1234567890-abcdefgh')
  })

  it('WEB_BASE_URL 未設定なら CORS 許可オリジンの先頭にフォールバックする', async () => {
    silenceWarn()
    const deps = await createDeps({
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net,https://preview.example.net',
    })

    expect(deps.webBaseUrl).toBe('https://example.cloudfront.net')
  })

  it('フォールバック時は設定漏れに気づけるよう警告を出す', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await createDeps({ CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net' })

    expect(warn.mock.calls.flat().join('\n')).toContain('WEB_BASE_URL')
  })

  it('空白のみの WEB_BASE_URL は未設定として扱う', async () => {
    silenceWarn()
    const deps = await createDeps({
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net',
      WEB_BASE_URL: '   ',
    })

    expect(deps.webBaseUrl).toBe('https://example.cloudfront.net')
  })

  it('開発環境で両方未設定なら localhost:3000 になる', async () => {
    silenceWarn()
    expect((await createDeps({})).webBaseUrl).toBe('http://localhost:3000')
  })

  it('スキームの無い WEB_BASE_URL は起動エラーにする（壊れた URI で全配信が失敗するため）', async () => {
    silenceWarn()
    await expect(
      createDeps({ WEB_BASE_URL: 'liff.line.me/1234567890-abcdefgh' }),
    ).rejects.toThrowError(/must be an absolute URL/)
  })

  it('クエリ付きの WEB_BASE_URL は起動エラーにする', async () => {
    silenceWarn()
    await expect(createDeps({ WEB_BASE_URL: 'https://liff.line.me/app?a=b' })).rejects.toThrowError(
      /must not contain a query string or fragment/,
    )
  })

  it('http(s) 以外のスキームは起動エラーにする', async () => {
    silenceWarn()
    await expect(createDeps({ WEB_BASE_URL: 'javascript:alert(1)' })).rejects.toThrowError(
      /must use http\(s\)/,
    )
  })
})

describe('環境変数の読み出し (#416)', () => {
  // API サーバとバッチの起動口が同じ設定を見るための一本化。キー名は文字列リテラルのため、
  // 追加漏れ・typo は型検査では捕まらない（片方の起動口でだけ設定が効かない状態になる）
  it('合成が使う環境変数をすべてそのまま読み出す', () => {
    const source = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/warimaru',
      DATABASE_DRIVER: 'node-postgres',
      GOOGLE_OAUTH_CLIENT_ID: 'client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
      GOOGLE_OAUTH_REDIRECT_URI: 'https://example.com/oauth/gmail/callback',
      GMAIL_OAUTH_STATE_SECRET: 'state-secret',
      LINE_CHANNEL_SECRET: 'line-secret',
      AWS_REGION: 'ap-northeast-1',
      FAILSAFE_EMAIL_FROM: 'from@example.com',
      FAILSAFE_EMAIL_TO: 'to@example.com',
      FAILSAFE_FAILURE_THRESHOLD: '3',
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net',
      WEB_BASE_URL: 'https://liff.line.me/1234567890-abcdefgh',
    }

    expect(compositionEnvFromEnvironment(source)).toEqual(source)
  })

  it('未設定のキーは undefined のまま返す（既定値をここで埋めない）', () => {
    expect(compositionEnvFromEnvironment({})).toEqual({
      NODE_ENV: undefined,
      DATABASE_URL: undefined,
      DATABASE_DRIVER: undefined,
      GOOGLE_OAUTH_CLIENT_ID: undefined,
      GOOGLE_OAUTH_CLIENT_SECRET: undefined,
      GOOGLE_OAUTH_REDIRECT_URI: undefined,
      GMAIL_OAUTH_STATE_SECRET: undefined,
      LINE_CHANNEL_SECRET: undefined,
      AWS_REGION: undefined,
      FAILSAFE_EMAIL_FROM: undefined,
      FAILSAFE_EMAIL_TO: undefined,
      FAILSAFE_FAILURE_THRESHOLD: undefined,
      CORS_ALLOWED_ORIGINS: undefined,
      WEB_BASE_URL: undefined,
    })
  })
})

/**
 * 許可リストの出所の配線 (#533)
 *
 * 全ての API 要求が許可リスト照合を通るようになったため、取り違えると
 * 「本番で実利用者が全員 403」または「開発用の許可リストが本番に紛れ込む」ことになる。
 */
describe('許可リストの出所の配線 (#533)', () => {
  const LOCAL_DB_URL = 'postgresql://user:pass@localhost:5432/warimaru'

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('開発環境で AWS 未構成なら seed の開発ユーザーを許可リストにする（警告ログ付き）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const deps = await createDeps({ NODE_ENV: 'development', DATABASE_URL: LOCAL_DB_URL })

    // seed の開発フィクスチャ（adapters-postgres の scripts/seed/dev-fixtures.ts）と揃っていること
    await expect(deps.allowlistQuery.fetch()).resolves.toEqual({
      honeyLineUserId: 'U_HONEY_DEV',
      darlingLineUserId: 'U_DARLING_DEV',
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('開発フィクスチャの許可リスト'))
  })

  it('開発環境でも AWS が構成されていれば開発用の許可リストは使わない', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const deps = await createDeps({
      NODE_ENV: 'development',
      DATABASE_URL: LOCAL_DB_URL,
      AWS_REGION: 'ap-northeast-1',
    })

    // 実体（phase0_configs + Parameter Store）を引きに行くため、この環境では取得できない
    await expect(deps.allowlistQuery.fetch()).rejects.toThrow()
  })

  it('本番環境では AWS 未構成でも開発用の許可リストへ倒さない（取得できないまま断る）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const deps = await createDeps({
      NODE_ENV: 'production',
      DATABASE_URL: LOCAL_DB_URL,
      CORS_ALLOWED_ORIGINS: 'https://example.cloudfront.net',
    })

    await expect(deps.allowlistQuery.fetch()).rejects.toThrow()
  })
})
