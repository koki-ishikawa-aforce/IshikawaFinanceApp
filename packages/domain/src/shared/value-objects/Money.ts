/**
 * Money 値オブジェクト（日本円・整数）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.2
 *
 * kawasima: data 金額 = 整数
 */
import { z } from 'zod'

// .int() は NaN/Infinity を弾く。.safe() で安全整数域（|v| ≤ 2^53-1）に制限し、
// addMoney/subtractMoney の結果が安全整数域を超えて黙って精度を失うのを parse で検出する。
export const MoneySchema = z.number().int().safe().brand<'Money'>()
export type Money = z.infer<typeof MoneySchema>

export function money(value: number): Money {
  return MoneySchema.parse(value)
}

export function addMoney(a: Money, b: Money): Money {
  return money(a + b)
}

export function subtractMoney(a: Money, b: Money): Money {
  return money(a - b)
}
