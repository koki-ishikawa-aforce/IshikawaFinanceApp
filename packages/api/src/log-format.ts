/**
 * ログ整形の小さな共有ヘルパー。
 *
 * 許可リスト照合ガード（#533）とその参照の使い回し（#650 の縮退運転）の両方が、
 * 外部由来の失敗理由をログに残す際に同じ整形規則を必要とするため、ここに集約する。
 */

/** 制御文字（コードポイント 0 から 31、および 127）かどうか */
function isControlCodePoint(codePoint: number): boolean {
  return codePoint <= 31 || codePoint === 127
}

/**
 * ログに載せる文字列を1行に収める。要求パスなど呼び出し側が決める文字列は制御文字を
 * 含みうる（hono は `%` を含むパスを復号する）。そのまま出すとログ行を分割して偽の
 * 警告行を作れるので、制御文字を潰し、長さも切る。
 */
export function loggable(value: string, maxLength: number): string {
  let result = ''
  for (const char of value.slice(0, maxLength)) {
    result += isControlCodePoint(char.codePointAt(0) ?? 0) ? '?' : char
  }
  return result
}

/** 取得失敗の種別と理由。許可リスト側のエラーは PII を含まない（構成名・パラメータのパス） */
export function errorDetailOf(e: unknown): string {
  if (!(e instanceof Error)) return 'unknown'
  return `${e.name}: ${loggable(e.message, 200)}`
}
