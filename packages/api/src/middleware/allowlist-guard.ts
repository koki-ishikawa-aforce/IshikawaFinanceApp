/**
 * 許可リスト照合ガード（#533）
 *
 * 夫婦 2 人として許可リストに登録されていない LINE ユーザーからの要求を、ルートへ届く前に断る。
 * 役割判定は画面側でも行われるが、画面を経由せず API を直接呼ばれるとその判定は効かない。
 * 認証（LINE ID トークン検証）は「LINE の正規利用者か」しか見ないため、認証だけでは
 * 世帯外のユーザーが自分名義のデータ行を作れてしまう（P1-2 の入口を全ルートに広げる）。
 *
 * 判定そのものはドメイン関数 `judgeRole` に委ね、api 層では再実装しない。
 *
 * @see docs/domain/08f-ul-オンボーディング認証.md §2
 */
import type { MiddlewareHandler } from 'hono'
import type { AllowlistQuery } from '@warimaru/domain'
import { PermissionDeniedError, judgeRole } from '@warimaru/domain'
import type { AppEnv } from '../env.js'
import { traceIdOf } from '../trace-id.js'

/**
 * 自前で許可リストを照合し、判定結果をドメインイベント（RoleJudged / AccessDenied）として
 * 残す経路。ここでガードが先に断つと拒否の監査記録が失われるため素通しする。
 * 素通ししても、その経路自身が不一致を 403 で断つ（routes/onboarding.ts の POST /register。
 * 登録済みかどうかより前に照合するため、既存のアプリユーザー行では素通しできない）。
 */
const SELF_JUDGING_PATHS: ReadonlySet<string> = new Set(['/api/onboarding/register'])

/**
 * ログに載せる文字列を1行に収める。要求パスは要求者が決める文字列で、hono は `%` を含む
 * パスを復号するため改行を紛れ込ませられる。そのまま出すとログ行を分割して偽の警告行を
 * 作れるので、制御文字を潰し、長さも切る。
 */
function loggable(value: string, maxLength: number): string {
  // eslint-disable-next-line no-control-regex -- 制御文字を潰すことが目的
  return value.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, maxLength)
}

function loggablePath(path: string): string {
  return loggable(path, 100)
}

/** 取得失敗の種別と理由。許可リスト側のエラーは PII を含まない（構成名・パラメータのパス） */
function errorDetailOf(e: unknown): string {
  if (!(e instanceof Error)) return 'unknown'
  return `${e.name}: ${loggable(e.message, 200)}`
}

export interface AllowlistGuardDeps {
  allowlistQuery: AllowlistQuery
  /** テストから時刻を差し込むための注入点（既定は実時刻） */
  now?: () => Date
}

export function createAllowlistGuardMiddleware(
  deps: AllowlistGuardDeps,
): MiddlewareHandler<AppEnv> {
  const now = deps.now ?? ((): Date => new Date())

  return async (c, next) => {
    if (SELF_JUDGING_PATHS.has(c.req.path)) return next()

    // 閲覧者が確定していない要求はここまで来ない（認証ミドルウェアが先に 401 で断つ）。
    // 付け替えでガードだけが残った場合に素通しさせないため、ここでも閉じる。
    const viewerId = c.get('viewerId')
    if (viewerId === undefined) {
      return c.json({ error: 'Missing Authorization header' }, 401)
    }

    let allowlist
    try {
      allowlist = await deps.allowlistQuery.fetch()
    } catch (e) {
      // 取得できないときは通さない（fail-closed）。素通しにすると許可リストの障害が
      // そのまま「誰でも通る」状態になり、塞いだつもりの入口が開く。
      // 症状（全 API が 503）は同じでも原因は「構成が足りない（phase0_configs 未投入・
      // Parameter Store にパラメータが無い・AWS 未構成）」と「一時障害（タイムアウト・
      // スロットリング）」に分かれ、前者は待っても直らない。どちらを見に行けばよいかを
      // 判別できるよう、種別と理由の両方を残す（いずれも PII を含まない）。
      console.error(
        `許可リストを取得できなかったため要求を拒否した（${errorDetailOf(e)}, path=${loggablePath(c.req.path)}）`,
      )
      return c.json(
        { error: '利用者の確認ができませんでした。時間をおいてやり直してください' },
        503,
      )
    }

    if (judgeRole(viewerId, allowlist, now()).kind === 'rejected') {
      console.warn(
        `許可リストに無い利用者からの要求を拒否した（user=${traceIdOf(viewerId)}, path=${loggablePath(c.req.path)}）`,
      )
      // ドメインエラー → HTTP の写像は error-handler に集約する（文言とステータスを複製しない）
      throw new PermissionDeniedError('このアプリは特定ユーザー専用です（許可リスト不一致）')
    }

    await next()
  }
}
