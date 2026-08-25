/**
 * 許可リスト参照の使い回し（#533）
 *
 * 許可リストは Phase0 の構成情報（夫婦 2 人の LINE userID）で実質的に変化しないが、
 * 実体は DB（phase0_configs）+ AWS Parameter Store にあり、参照のたびに外部呼び出しが増える。
 * 許可リスト照合ガードが `/api/*` の全要求で照合するようになったため、参照を一定時間使い回す。
 *
 * 取得の最適化は driven port の実装側の関心として、ここ（Query のデコレータ）に閉じる。
 */
import type { Allowlist, AllowlistQuery } from '@warimaru/domain'
import { withTimeout } from './with-timeout.js'

/**
 * 既定の保持時間。保持している間は許可リストの変更が反映されないが、2 人世帯の構成が
 * 変わる頻度に対して十分短い。長く取りすぎると入れ替え直後に旧メンバーが通ってしまう。
 */
export const DEFAULT_ALLOWLIST_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * 取得の上限時間。実体の Neon（fetch）と Parameter Store（SSM クライアント）はどちらも
 * 自前のタイムアウトを持たない。許可リストは全要求の応答パスに乗るため、1 回のハングを
 * そのままにすると、取得を共有する後続の要求まで無期限に待たされる（503 すら返らない）。
 */
export const DEFAULT_ALLOWLIST_FETCH_TIMEOUT_MS = 5_000

export interface CachingAllowlistQueryOptions {
  /** 保持時間（ミリ秒）。0 を渡すと毎回取得する */
  ttlMs?: number
  /** 1 回の取得の上限時間（ミリ秒） */
  timeoutMs?: number
  /** テストから時刻を差し込むための注入点（既定は実時刻） */
  now?: () => Date
}

export function createCachingAllowlistQuery(
  inner: AllowlistQuery,
  options: CachingAllowlistQueryOptions = {},
): AllowlistQuery {
  const ttlMs = options.ttlMs ?? DEFAULT_ALLOWLIST_CACHE_TTL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_ALLOWLIST_FETCH_TIMEOUT_MS
  const now = options.now ?? ((): Date => new Date())
  let cached: { allowlist: Allowlist; expiresAt: number } | null = null
  let inFlight: Promise<Allowlist> | null = null

  return {
    async fetch(): Promise<Allowlist> {
      if (cached !== null && now().getTime() < cached.expiresAt) return cached.allowlist
      // 同時に届いた要求で取得を重複させない（1 回の取得を共有する）。
      // 失敗は覚え込まず（cached を更新しない）、次の要求で引き直す。上限時間で必ず決着させるため、
      // 応答が返らない相手に当たっても共有した要求ごと待ち続けることはない。
      inFlight ??= withTimeout(inner.fetch(), timeoutMs)
        .then(allowlist => {
          cached = { allowlist, expiresAt: now().getTime() + ttlMs }
          return allowlist
        })
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },
  }
}
