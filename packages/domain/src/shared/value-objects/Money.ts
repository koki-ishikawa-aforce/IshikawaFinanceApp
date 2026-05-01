/**
 * Money 値オブジェクト（日本円・整数）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.2
 *
 * kawasima: data 金額 = 整数
 */
import { z } from 'zod'

export const MoneySchema = z.number().int().finite().brand<'Money'>()
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
