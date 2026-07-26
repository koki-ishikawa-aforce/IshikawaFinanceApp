import { describe, it, expect } from 'vitest'
import {
  BALANCE_FRESHNESS_THRESHOLD_DAYS,
  BalanceFreshnessSchema,
  evaluateBalanceFreshness,
} from '../../../src/household-analysis/value-objects/BalanceFreshness'
import { AccountIdSchema } from '../../../src/shared/ids'
import { testUlid } from '../../helpers/ids'

const ACCOUNT_ID = AccountIdSchema.parse(testUlid('01ACC', 1))

/** 基準時刻から `days` 日前ちょうどの日時 */
function daysAgo(days: number, hours = 0): Date {
  const now = new Date('2026-07-26T09:00:00.000Z')
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000)
}

const NOW = new Date('2026-07-26T09:00:00.000Z')

describe('evaluateBalanceFreshness', () => {
  it('閾値は 35 日（OQ-44 の決定値）', () => {
    expect(BALANCE_FRESHNESS_THRESHOLD_DAYS).toBe(35)
  })

  it('34 日経過は鮮度OK', () => {
    const result = evaluateBalanceFreshness({
      accountId: ACCOUNT_ID,
      lastUpdatedAt: daysAgo(34),
      now: NOW,
    })
    expect(result.daysSinceLastUpdate).toBe(34)
    expect(result.status).toBe('ok')
  })

  it('35 日経過（閾値ちょうど）は鮮度アラート', () => {
    const result = evaluateBalanceFreshness({
      accountId: ACCOUNT_ID,
      lastUpdatedAt: daysAgo(35),
      now: NOW,
    })
    expect(result.daysSinceLastUpdate).toBe(35)
    expect(result.status).toBe('alert')
  })

  it('36 日経過は鮮度アラート', () => {
    const result = evaluateBalanceFreshness({
      accountId: ACCOUNT_ID,
      lastUpdatedAt: daysAgo(36),
      now: NOW,
    })
    expect(result.daysSinceLastUpdate).toBe(36)
    expect(result.status).toBe('alert')
  })

  it('経過日数は丸 1 日単位で切り捨てる（34 日 23 時間は 34 日 = 鮮度OK）', () => {
    const result = evaluateBalanceFreshness({
      accountId: ACCOUNT_ID,
      lastUpdatedAt: daysAgo(34, 23),
      now: NOW,
    })
    expect(result.daysSinceLastUpdate).toBe(34)
    expect(result.status).toBe('ok')
  })

  it('更新直後は 0 日で鮮度OK', () => {
    const result = evaluateBalanceFreshness({
      accountId: ACCOUNT_ID,
      lastUpdatedAt: NOW,
      now: NOW,
    })
    expect(result.daysSinceLastUpdate).toBe(0)
    expect(result.status).toBe('ok')
  })

  it('最終更新が未来日時でも経過日数は負にならない（0 に丸める）', () => {
    const result = evaluateBalanceFreshness({
      accountId: ACCOUNT_ID,
      lastUpdatedAt: new Date('2026-08-01T00:00:00.000Z'),
      now: NOW,
    })
    expect(result.daysSinceLastUpdate).toBe(0)
    expect(result.status).toBe('ok')
  })

  it('経過は暦日ではなく経過時間で数える（JST の日付をまたいでも 24 時間未満は 1 日にしない）', () => {
    // 最終更新 = JST 6/21 23:00 / 現在 = JST 7/26 09:00 → JST の暦日差は 35 日だが、
    // 実経過は 34 日 10 時間なので鮮度OK のまま
    const result = evaluateBalanceFreshness({
      accountId: ACCOUNT_ID,
      lastUpdatedAt: new Date('2026-06-21T14:00:00.000Z'),
      now: NOW,
    })
    expect(result.daysSinceLastUpdate).toBe(34)
    expect(result.status).toBe('ok')
  })

  it('借用した口座ID・最終更新日時をそのまま返す', () => {
    const lastUpdatedAt = daysAgo(40)
    const result = evaluateBalanceFreshness({ accountId: ACCOUNT_ID, lastUpdatedAt, now: NOW })
    expect(result.accountId).toBe(ACCOUNT_ID)
    expect(result.lastUpdatedAt).toEqual(lastUpdatedAt)
  })
})

describe('BalanceFreshnessSchema', () => {
  const valid = {
    accountId: ACCOUNT_ID,
    lastUpdatedAt: NOW,
    daysSinceLastUpdate: 10,
    status: 'ok',
  }

  it('経過日数が負の値は拒否する', () => {
    expect(() => BalanceFreshnessSchema.parse({ ...valid, daysSinceLastUpdate: -1 })).toThrow()
  })

  it('経過日数の小数は拒否する（丸 1 日単位で数えるため）', () => {
    expect(() => BalanceFreshnessSchema.parse({ ...valid, daysSinceLastUpdate: 1.5 })).toThrow()
  })

  it('鮮度状態は ok / alert の 2 値のみ受理する', () => {
    expect(() => BalanceFreshnessSchema.parse({ ...valid, status: 'warn' })).toThrow()
  })

  it('ULID 形式でない口座ID は拒否する', () => {
    expect(() => BalanceFreshnessSchema.parse({ ...valid, accountId: 'ACC_001' })).toThrow()
  })
})
