/**
 * ローカル開発専用ドライバ（`pg`）を本番向けの配布物から外したこと（#428）を守る。
 *
 * 本番は neon-http だけを使い、`pg` はローカル開発と統合テストでしか読み込まない（#349）。
 * その前提のもとで依存宣言も devDependencies に移したため、守るべきことが 2 つある:
 *
 * 1. 宣言が `dependencies` に戻っていないこと（戻ると本番向けインストールに再び含まれる。
 *    動くので誰も気づかず、配布物が黙って太る）
 * 2. `pg` が居ない環境でローカル向けの接続先を指したときに、モジュール解決エラーのままではなく
 *    原因と対処が読み取れるエラーになること（本番向けインストールのままローカル DB を指す、
 *    という設定ミスがこの経路の唯一の踏み方で、素のエラーだと DB 障害と見分けが付かない）
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// `pg` が解決できない環境（本番向けインストール）を再現する。
// mock ファクトリの例外はそのまま import の失敗になるため、実際に居ない状態と同じ経路を通る。
vi.mock('pg', () => {
  throw new Error("Cannot find module 'pg'")
})

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as PackageManifest

describe('pg の依存宣言（#428）', () => {
  it('pg と型定義は devDependencies にだけ宣言されている', () => {
    expect(manifest.devDependencies).toHaveProperty('pg')
    expect(manifest.devDependencies).toHaveProperty('@types/pg')
    expect(manifest.dependencies ?? {}).not.toHaveProperty('pg')
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@types/pg')
  })

  it('本番で使うドライバ（@neondatabase/serverless）は dependencies に残っている', () => {
    // 「全部 devDependencies へ移した」という別の壊れ方を、上のテストだけでは検出できない
    expect(manifest.dependencies).toHaveProperty('@neondatabase/serverless')
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('@neondatabase/serverless')
  })
})

describe('pg が居ない環境での接続（#428）', () => {
  const LOCAL_URL = 'postgres://postgres:postgres@localhost:5432/warimaru_dev'
  const NEON_URL = 'postgresql://user:pass@ep-cool-block-123.ap-northeast-1.aws.neon.tech/warimaru'

  it('node-postgres を選ぶと、原因と対処を添えたエラーになる', async () => {
    const { createDbConnection } = await import('../../src/client')

    const error = await createDbConnection({
      databaseUrl: LOCAL_URL,
      isProduction: false,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/devDependency/)
    expect((error as Error).message).toMatch(/DATABASE_URL/)
    // 元のモジュール解決エラーは調査のために cause へ残す
    expect((error as Error).cause).toBeInstanceOf(Error)
  })

  it('neon-http（本番相当）の接続は pg が居なくても作れる', async () => {
    // 翻訳したエラーが本番経路にまで漏れていないことを対にして固定する
    const { createDbConnection } = await import('../../src/client')

    const connection = await createDbConnection({ databaseUrl: NEON_URL, isProduction: true })
    await connection.close()

    expect(connection.db).toBeDefined()
  })
})
