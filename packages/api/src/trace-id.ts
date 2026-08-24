/**
 * ログ用の短縮識別子
 *
 * LINE userID・トークルーム ID は個人を辿れる識別子（PII）のためそのままログに出さず、
 * 復元できない形へ潰したうえで「同時刻の別の相手と区別できる」最小限だけを残す。
 */
import { createHash } from 'node:crypto'

export function traceIdOf(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}
