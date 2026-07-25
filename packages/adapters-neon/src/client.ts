/**
 * DB 接続ファクトリ（ドライバ切替）
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §2.5
 *
 * 接続先に応じて 2 つのドライバを使い分ける（#323）:
 *
 * - `neon-http`（@neondatabase/serverless）— Neon の SQL-over-HTTP エンドポイント専用。本番。
 * - `node-postgres`（pg）— 素の PostgreSQL。ローカル開発（docker compose の db）と統合テスト / E2E。
 *
 * どちらも `Db` 型（PgDatabase）に収まるため、adapter 実装はドライバを意識しない。
 * ただし `db.transaction`（interactive transaction）は neon-http では実行時に throw するため、
 * **adapter は引き続き単文 upsert（INSERT ... ON CONFLICT DO UPDATE）で完結させること**。
 * ローカルで node-postgres を使うと db.transaction が動いてしまい、本番でのみ壊れる
 * コードを書けてしまう点に注意する。interactive transaction を要する save が必要になった時点で、
 * WebSocket `Pool`（@neondatabase/serverless + drizzle-orm/neon-serverless）のファクトリを追加する。
 */
import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http'
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema'

/**
 * ドライバ横断の DB 型。
 * 本番 = drizzle-orm/neon-http、ローカル開発 / 統合テスト / E2E = drizzle-orm/node-postgres。
 * どちらも PgDatabase のサブタイプであり、adapter はこの共通型にのみ依存する。
 * （両ファクトリとも `{ schema }` を渡すこと — 渡さないと TFullSchema が単一化しない）
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export type DbDriverKind = 'neon-http' | 'node-postgres'

const DB_DRIVER_KINDS: readonly DbDriverKind[] = ['neon-http', 'node-postgres']

/** Neon のエンドポイントのホスト名サフィックス（例: ep-xxx.ap-northeast-1.aws.neon.tech） */
const NEON_HOST_SUFFIX = '.neon.tech'

export interface DbDriverConfig {
  /** 接続文字列（DATABASE_URL） */
  databaseUrl: string
  /**
   * 本番かどうか。true なら neon-http に固定する。
   * NODE_ENV の解釈は呼び出し側（api の `isProduction()`）を単一の情報源とし、
   * ここでは真偽値だけを受け取る。
   */
  isProduction: boolean
  /**
   * ドライバの明示指定（DATABASE_DRIVER）。未設定なら接続先ホストから判定する。
   * Neon 以外のホストで neon-http を使う等、判定を上書きしたい場合にのみ指定する。
   */
  driverOverride?: string | undefined
}

/** DATABASE_DRIVER の検証。未設定は undefined、未知の値は起動エラー（黙って既定へ倒さない） */
function parseDriverOverride(value: string | undefined): DbDriverKind | undefined {
  // ホスト判定・NODE_ENV 判定と同じく、前後の空白と大文字小文字は吸収する
  const normalized = value?.trim().toLowerCase()
  if (normalized === undefined || normalized === '') return undefined
  if ((DB_DRIVER_KINDS as readonly string[]).includes(normalized)) {
    return normalized as DbDriverKind
  }
  throw new Error(
    `DATABASE_DRIVER must be one of ${DB_DRIVER_KINDS.join(' / ')} (got: ${normalized}).`,
  )
}

/** 接続先が Neon のエンドポイントか。URL として解釈できない文字列は Neon ではないとみなす */
function isNeonHost(databaseUrl: string): boolean {
  let host: string
  try {
    host = new URL(databaseUrl).hostname.toLowerCase()
  } catch {
    return false
  }
  return host === 'neon.tech' || host.endsWith(NEON_HOST_SUFFIX)
}

/**
 * 使用するドライバを決める。
 *
 * 本番は接続先ホストの綴りに関わらず neon-http に固定する。ホスト判定だけに任せると、
 * 本番の接続文字列が一時的に別ホストを指した拍子にローカル向けドライバへ静かに倒れ、
 * 接続方式の取り違えが起動時ではなくクエリ実行時の障害として出てしまうため。
 * DATABASE_DRIVER で本番に node-postgres を要求した場合は、事故と設定の区別がつかないので拒否する。
 */
export function resolveDbDriver(config: DbDriverConfig): DbDriverKind {
  const override = parseDriverOverride(config.driverOverride)

  if (config.isProduction) {
    if (override !== undefined && override !== 'neon-http') {
      throw new Error(
        `DATABASE_DRIVER=${override} is not allowed in production. Production runs on Neon over HTTP (neon-http).`,
      )
    }
    return 'neon-http'
  }

  return override ?? (isNeonHost(config.databaseUrl) ? 'neon-http' : 'node-postgres')
}

/**
 * DB と後始末をまとめた接続ハンドル。
 * node-postgres はコネクションプールを保持するため、プロセスを終える短命な用途
 * （seed などのスクリプト）では close() を呼ばないとプロセスが終了しない。
 * neon-http は接続を保持しないため close() は何もしない。
 */
export interface DbConnection {
  db: Db
  close: () => Promise<void>
}

function createNeonHttpConnection(databaseUrl: string): DbConnection {
  const client = neon(databaseUrl)
  return { db: drizzleNeonHttp(client, { schema }), close: () => Promise.resolve() }
}

function createNodePgConnection(databaseUrl: string): DbConnection {
  const pool = new Pool({ connectionString: databaseUrl })
  // アイドル接続のエラー（DB 再起動・docker compose down 等）は 'error' で通知される。
  // リスナーが無いと Node が unhandled 'error' としてプロセスごと落とすため、
  // 常駐するローカル開発の API が DB の再起動で不可解に停止する。ログに残して致命化させない。
  pool.on('error', err => console.error('pg pool error (idle client):', err))
  return { db: drizzleNodePg(pool, { schema }), close: () => pool.end() }
}

/** 接続先に応じたドライバで DB 接続を開く（close() が必要な短命プロセス向け） */
export function createDbConnection(config: DbDriverConfig): DbConnection {
  return resolveDbDriver(config) === 'neon-http'
    ? createNeonHttpConnection(config.databaseUrl)
    : createNodePgConnection(config.databaseUrl)
}

/** 接続先に応じたドライバで DB を組み立てる（プロセスと寿命を共にする API 本体向け） */
export function createDb(config: DbDriverConfig): Db {
  return createDbConnection(config).db
}
