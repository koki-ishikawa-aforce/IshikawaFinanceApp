/**
 * ローカル開発専用ドライバの遅延読み込みを、**読み込みが起きたかどうか**で検証する（#349）。
 *
 * noStaticNodePgImport.test.ts はソースの静的解析なので、書き方の抜けがあれば素通りする。
 * こちらは `vi.mock` のファクトリが「そのモジュールが実際に import された時にだけ評価される」
 * 性質を使い、接続方式ごとに読み込みが起きた / 起きなかったを直接観測する。
 *
 * 本番相当（neon-http）で 1 つも読み込まれないことが受け入れ条件そのもので、
 * ローカル向け（node-postgres）では両方読み込まれることを対にして固定する
 * （「常に読み込まれない」という別の壊れ方を、否定形だけでは検出できないため）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loadPg, loadNodePgDriver } = vi.hoisted(() => ({
  loadPg: vi.fn(),
  loadNodePgDriver: vi.fn(),
}))

vi.mock('pg', () => {
  loadPg()
  class FakePool {
    on(): void {}
    end(): Promise<void> {
      return Promise.resolve()
    }
  }
  return { Pool: FakePool, default: { Pool: FakePool } }
})

vi.mock('drizzle-orm/node-postgres', () => {
  loadNodePgDriver()
  return { drizzle: () => ({ __fake: 'node-postgres db' }) }
})

const NEON_URL = 'postgresql://user:pass@ep-cool-block-123.ap-northeast-1.aws.neon.tech/warimaru'
const LOCAL_URL = 'postgres://postgres:postgres@localhost:5432/warimaru_dev'

describe('ローカル開発専用ドライバの遅延読み込み（#349）', () => {
  beforeEach(() => {
    loadPg.mockClear()
    loadNodePgDriver.mockClear()
  })

  it('client を読み込んだだけでは pg も node-postgres ドライバも読み込まれない', async () => {
    await import('../../src/client')

    expect(loadPg).not.toHaveBeenCalled()
    expect(loadNodePgDriver).not.toHaveBeenCalled()
  })

  it('neon-http（本番相当）の接続を作っても読み込まれない', async () => {
    const { createDbConnection } = await import('../../src/client')

    const connection = await createDbConnection({ databaseUrl: NEON_URL, isProduction: true })
    await connection.close()

    expect(loadPg).not.toHaveBeenCalled()
    expect(loadNodePgDriver).not.toHaveBeenCalled()
  })

  it('node-postgres（ローカル開発）の接続を作ったときに初めて両方読み込まれる', async () => {
    const { createDbConnection } = await import('../../src/client')

    const connection = await createDbConnection({ databaseUrl: LOCAL_URL, isProduction: false })
    await connection.close()

    expect(loadPg).toHaveBeenCalled()
    expect(loadNodePgDriver).toHaveBeenCalled()
  })
})
