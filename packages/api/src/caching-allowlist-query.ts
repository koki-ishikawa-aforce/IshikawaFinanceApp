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
import { errorDetailOf } from './log-format.js'

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

/**
 * healthy: 直近の取得に成功している。
 * degraded: 取得できていないが、猶予時間内のため直近の内容で縮退運転している(#650 選択肢 B。
 *   利用者への影響は無い)。
 * unavailable: 取得できず、縮退運転の猶予も無い(直近の生取得が一度も無い、または猶予時間を
 *   超えた)。fail-closed により全要求が拒否されている状態。
 */
export type AllowlistHealthStatus = 'healthy' | 'degraded' | 'unavailable'

export interface AllowlistHealth {
  status: AllowlistHealthStatus
  /** 'healthy' 以外のときのみ設定。LINE userID 等の PII は含まない */
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
  /** 現在の取得状況を返す（/health が参照する） */
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
  // 直近の取得結果。健全なときは 'healthy'。health() はこれをそのまま返す
  let status: AllowlistHealthStatus = 'healthy'
  // 健全でなくなった時刻。'healthy' に戻ると null に戻す
  let unhealthySince: number | null = null
  // 直近の取得失敗の理由（PII を含まない）。健全なときは null
  let lastErrorDetail: string | null = null

  function detailOf(statusLabel: string): string {
    const since = unhealthySince === null ? '' : `${new Date(unhealthySince).toISOString()} から`
    const reason = lastErrorDetail === null ? '' : `（${lastErrorDetail}）`
    return `許可リストを取得できず、${since}${statusLabel}${reason}`
  }

  return {
    async fetch(): Promise<Allowlist> {
      if (cached !== null && now().getTime() < cached.expiresAt) return cached.allowlist
      // 同時に届いた要求で取得を重複させない（1 回の取得を共有する）。上限時間で必ず決着させる
      // ため、応答が返らない相手に当たっても共有した要求ごと待ち続けることはない。
      inFlight ??= withTimeout(inner.fetch(), timeoutMs)
        .then(allowlist => {
          const fetchedAt = now().getTime()
          cached = { allowlist, expiresAt: fetchedAt + ttlMs }
          lastGood = { allowlist, fetchedAt }
          status = 'healthy'
          unhealthySince = null
          lastErrorDetail = null
          return allowlist
        })
        .catch((e: unknown) => {
          lastErrorDetail = errorDetailOf(e)
          const good = lastGood
          const graceDeadline =
            good !== null && staleGraceMs > 0 ? good.fetchedAt + staleGraceMs : null
          if (good !== null && graceDeadline !== null && now().getTime() <= graceDeadline) {
            // 猶予時間内なら直近に取得できていた内容で縮退運転する（#650 選択肢 B）。cached も
            // 更新して次の要求からは取得を試みず即応答するが、有効期限は猶予の終わりでクランプ
            // する（ttlMs が猶予時間より長いと、猶予を過ぎても cached が有効なまま fail-closed
            // に戻れなくなるため）。猶予の起点は生の取得成功時刻に固定し、縮退運転を何度使い
            // 回しても「実態からどれだけずれているか」は伸びない
            unhealthySince ??= now().getTime()
            status = 'degraded'
            cached = {
              allowlist: good.allowlist,
              expiresAt: Math.min(now().getTime() + ttlMs, graceDeadline),
            }
            console.error(detailOf('直近の内容で縮退運転している'))
            return good.allowlist
          }
          // 猶予が無い（直近の生取得が一度も無い）、または猶予時間を過ぎた。fail-closed に戻す
          // ため cached は更新しない（次の要求で引き直せる）。呼び出し元（allowlist-guard）が
          // 拒否ログを残すため、ここでは二重にログしない
          unhealthySince ??= now().getTime()
          status = 'unavailable'
          throw e
        })
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },

    health(): AllowlistHealth {
      if (status === 'healthy') return { status }
      if (status === 'degraded') return { status, detail: detailOf('直近の内容で縮退運転している') }
      return { status, detail: detailOf('fail-closed している') }
    },
  }
}
