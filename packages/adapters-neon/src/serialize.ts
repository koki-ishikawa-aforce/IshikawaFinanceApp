/**
 * 集約 ⇔ payload jsonb の変換
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §3
 *
 * JSONB 内の Date は ISO 8601 文字列で保持し、parse 前に revive する。
 * revive は Date#toISOString の出力形式（ミリ秒 + 'Z' 必須）に完全一致する
 * 文字列だけを Date に戻す。自由テキスト（merchantName 等）が偶然この形式に
 * 一致することは実質なく、仮に誤変換 / 変換漏れが起きても直後の Zod parse が
 * 型不一致で必ず throw するため、静かなデータ破損は起きない。
 * （'2026-07' の YearMonth や日付のみ文字列は形式不一致のため対象外）
 */
export const ISO_DATE_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * 集約 → payload: Date を ISO 文字列へ、undefined プロパティは除去
 * （exactOptionalPropertyTypes 下で `key?: T` を JSON に残さないため）
 */
export function serializeForPayload(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializeForPayload)
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined) continue
      result[key] = serializeForPayload(v)
    }
    return result
  }
  return value
}

/** payload → 集約の前段: ISO 8601 文字列を Date へ revive */
export function reviveDates(value: unknown): unknown {
  if (typeof value === 'string') {
    return ISO_DATE_TIME_REGEX.test(value) ? new Date(value) : value
  }
  if (Array.isArray(value)) return value.map(reviveDates)
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      result[key] = reviveDates(v)
    }
    return result
  }
  return value
}

/**
 * payload → 集約の復元（読み出しの唯一の経路、superRefine 不変条件が毎回再適用される）。
 * parse 失敗（= DB 破損 / スキーマ乖離）は ZodError をそのまま伝播する —
 * null 返却で「欠損」と偽装せず、運用境界で検知させる。
 */
export function parsePayload<T>(schema: { parse: (input: unknown) => T }, payload: unknown): T {
  return schema.parse(reviveDates(payload))
}
