/**
 * 許可リスト参照の使い回し（#533）と、取得できない間の縮退運転（#650）
 *
 * 許可リストは Phase0 の構成情報（夫婦 2 人の LINE userID）で実質的に変化しないが、
 * 実体は DB（phase0_configs）+ AWS Parameter Store にあり、参照のたびに外部呼び出しが増える。
 * 許可リスト照合ガードが `/api/*` の全要求で照合するようになったため、参照を一定時間使い回す。
 *
 * 取得の最適化は driven port の実装側の関心として、ここ（Query のデコレータ）に閉じる。
 *
 * 許可リストの実体（DB / Parameter Store）が一時的に読めなくなっただけで夫婦 2 人とも
 * 家計簿を一切使えなくなるのは見返りが小さい（#650）。直近に読めていた内容が一定時間
 * （猶予時間）以内なら、それで判定を続ける（縮退運転）。猶予時間を過ぎたら安全側に倒して
 * fail-closed に戻る（読めない期間が長いほど、直近の内容が実態とずれている可能性も上がるため）。
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

/**
 * 縮退運転の猶予時間。直近に取得できていた内容がこれより古ければ fail-closed に戻る。
 * 許可リストから外れた直後の相手も、読めない間は最大この時間だけ通ってしまう（#650 選択肢 B）。
 */
export const DEFAULT_ALLOWLIST_STALE_GRACE_MS = 30 * 60 * 1000

export type AllowlistHealthStatus = 'healthy' | 'degraded'

export interface AllowlistHealth {
  status: AllowlistHealthStatus
  /** 'degraded' のときのみ設定。LINE userID 等の PII は含まない */
  detail?: string
}

export interface CachingAllowlistQueryOptions {
  /** 保持時間（ミリ秒）。0 を渡すと毎回取得する */
  ttlMs?: number
  /** 1 回の取得の上限時間（ミリ秒） */
  timeoutMs?: number
  /** 縮退運転の猶予時間（ミリ秒）。0 を渡すと縮退運転せず即 fail-closed する */
  staleGraceMs?: number
  /** テストから時刻を差し込むための注入点（既定は実時刻） */
  now?: () => Date
}

export interface CachingAllowlistQuery extends AllowlistQuery {
  /** 現在、直近取得できた内容で縮退運転しているかを返す（/health が参照する） */
  health(): AllowlistHealth
}

export function createCachingAllowlistQuery(
  inner: AllowlistQuery,
  options: CachingAllowlistQueryOptions = {},
): CachingAllowlistQuery {
  const ttlMs = options.ttlMs ?? DEFAULT_ALLOWLIST_CACHE_TTL_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_ALLOWLIST_FETCH_TIMEOUT_MS
  const staleGraceMs = options.staleGraceMs ?? DEFAULT_ALLOWLIST_STALE_GRACE_MS
  const now = options.now ?? ((): Date => new Date())
  let cached: { allowlist: Allowlist; expiresAt: number } | null = null
  let inFlight: Promise<Allowlist> | null = null
  // 直近に生の取得（縮退運転による使い回しではない）に成功した内容と時刻
  let lastGood: { allowlist: Allowlist; fetchedAt: number } | null = null
  // 縮退運転に入った時刻。健全なとき（直近の fetch が生の取得に成功しているとき）は null
  let degradedSince: number | null = null

  return {
    async fetch(): Promise<Allowlist> {
      if (cached !== null && now().getTime() < cached.expiresAt) return cached.allowlist
      // 同時に届いた要求で取得を重複させない（1 回の取得を共有する）。
      // 失敗は覚え込まず（cached を更新しない）、次の要求で引き直す。上限時間で必ず決着させるため、
      // 応答が返らない相手に当たっても共有した要求ごと待ち続けることはない。
      inFlight ??= withTimeout(inner.fetch(), timeoutMs)
        .then(allowlist => {
          const fetchedAt = now().getTime()
          cached = { allowlist, expiresAt: fetchedAt + ttlMs }
          lastGood = { allowlist, fetchedAt }
          degradedSince = null
          return allowlist
        })
        .catch((e: unknown) => {
          // 猶予時間内なら直近に取得できていた内容で縮退運転する（#650 選択肢 B）。
          // cached も更新して次の要求からは取得を試みず即応答する（外部呼び出しを重ねない）。
          // 猶予時間の判定は生の取得成功時刻からの経過で行う（縮退運転中に何度使い回しても
          // 「実態からどれだけずれているか」は伸びない）。
          if (lastGood !== null && now().getTime() - lastGood.fetchedAt <= staleGraceMs) {
            degradedSince ??= now().getTime()
            cached = { allowlist: lastGood.allowlist, expiresAt: now().getTime() + ttlMs }
            return lastGood.allowlist
          }
          throw e
        })
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },

    health(): AllowlistHealth {
      if (degradedSince === null) return { status: 'healthy' }
      return {
        status: 'degraded',
        detail: `許可リストを取得できず、${new Date(degradedSince).toISOString()} から直近に取得できた内容で縮退運転している（猶予 ${String(staleGraceMs / 60_000)} 分）`,
      }
    },
  }
}
