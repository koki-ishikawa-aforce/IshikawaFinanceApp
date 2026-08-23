/**
 * ローカル開発専用ドライバ（`pg`）を読み込めなかったときの振る舞い（#428）。
 *
 * `pg` は devDependencies に置いたため、本番向けにインストールした環境には存在しない。
 * その環境でローカル向けの接続先（素の PostgreSQL）を指すのが、この経路を踏む唯一の道で、
 * 素のモジュール解決エラーのままだと「DB が落ちている」と読み違えられる。
 *
 * 一方で、翻訳を失敗全般に広げると逆の誤誘導になる（`pg` が居るのに初期化で落ちた場合まで
 * 「依存が足りない」と報告する）。**解決できなかった失敗だけを翻訳する**ことを対で固定する。
 *
 * 各テストで読み込み結果を変えるため、`vi.mock`（ファイル単位・巻き上げ）ではなく
 * `vi.resetModules()` + `vi.doMock` で都度組み替える。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LOCAL_URL = 'postgres://postgres:postgres@localhost:5432/warimaru_dev'
const NEON_URL = 'postgresql://user:pass@ep-cool-block-123.ap-northeast-1.aws.neon.tech/warimaru'

/** cause の連鎖を平坦化する。モック越しの失敗はラッパーに包まれて届くため、元の原因は連鎖の奥にある */
function causeChain(error: unknown): Error[] {
  const chain: Error[] = []
  for (
    let current = error;
    current instanceof Error && chain.length < 10;
    current = current.cause
  ) {
    chain.push(current)
  }
  return chain
}

async function connect(databaseUrl: string, isProduction: boolean) {
  const { createDbConnection } = await import('../../src/client')
  return createDbConnection({ databaseUrl, isProduction })
}

describe('node-postgres ドライバの読み込みに失敗したとき（#428）', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('pg')
  })

  it('pg が解決できないと、原因と対処を添えたエラーになる', async () => {
    vi.doMock('pg', () => {
      throw new Error("Cannot find module 'pg'")
    })

    const error = await connect(LOCAL_URL, false).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/devDependency/)
    expect((error as Error).message).toMatch(/DATABASE_URL/)
    // 元のモジュール解決エラーを調査のために残す（差し替わっていると原因が追えない）
    expect(causeChain(error).some(e => /Cannot find module 'pg'/.test(e.message))).toBe(true)
  })

  it('解決できたうえでの失敗は翻訳せず、そのまま投げる', async () => {
    // pg は居るが読み込み中に落ちた状況。ここまで「依存が足りない」と報告すると原因を見失う
    vi.doMock('pg', () => {
      throw new Error('pg failed to initialize')
    })

    const error = await connect(LOCAL_URL, false).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(/devDependency/)
    expect(causeChain(error).some(e => /pg failed to initialize/.test(e.message))).toBe(true)
  })

  it('neon-http（本番相当）の接続は pg が解決できなくても作れる', async () => {
    // 翻訳したエラーが本番経路へ漏れていないこと。pg 不在が前提な点が client.test.ts との差分
    vi.doMock('pg', () => {
      throw new Error("Cannot find module 'pg'")
    })

    const connection = await connect(NEON_URL, true)

    expect(connection.db).toBeDefined()
    await expect(connection.close()).resolves.toBeUndefined()
  })
})
