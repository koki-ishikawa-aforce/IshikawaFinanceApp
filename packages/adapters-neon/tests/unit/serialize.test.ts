import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { serializeForPayload, reviveDates, parsePayload } from '../../src/serialize'

describe('serializeForPayload', () => {
  it('ネスト構造内の Date を ISO 8601 文字列へ変換する', () => {
    const input = {
      common: { occurredAt: new Date('2026-07-06T01:23:45.678Z') },
      entries: [{ bookedAt: new Date('2026-01-31T15:00:00.000Z') }],
    }
    expect(serializeForPayload(input)).toEqual({
      common: { occurredAt: '2026-07-06T01:23:45.678Z' },
      entries: [{ bookedAt: '2026-01-31T15:00:00.000Z' }],
    })
  })

  it('undefined プロパティを除去する（exactOptionalPropertyTypes 対応）', () => {
    const input = { a: 1, b: undefined, nested: { c: undefined, d: 'x' } }
    expect(serializeForPayload(input)).toEqual({ a: 1, nested: { d: 'x' } })
  })

  it('null / プリミティブ / 空配列はそのまま', () => {
    expect(serializeForPayload({ a: null, b: 0, c: '', d: [] })).toEqual({
      a: null,
      b: 0,
      c: '',
      d: [],
    })
  })
})

describe('reviveDates', () => {
  it('Date#toISOString 形式の文字列だけを Date に戻す', () => {
    const revived = reviveDates({
      occurredAt: '2026-07-06T01:23:45.678Z',
      yearMonth: '2026-07',
      dateOnly: '2026-07-06',
      noMillis: '2026-07-06T00:00:00Z',
      merchantName: 'スーパー 2026-07-06T09:00',
    }) as Record<string, unknown>
    expect(revived.occurredAt).toBeInstanceOf(Date)
    expect((revived.occurredAt as Date).toISOString()).toBe('2026-07-06T01:23:45.678Z')
    // ISO 完全形式でない文字列は触らない
    expect(revived.yearMonth).toBe('2026-07')
    expect(revived.dateOnly).toBe('2026-07-06')
    expect(revived.noMillis).toBe('2026-07-06T00:00:00Z')
    expect(revived.merchantName).toBe('スーパー 2026-07-06T09:00')
  })

  it('serialize → revive の往復で Date が同値に戻る', () => {
    const original = {
      at: new Date('2026-12-31T14:59:59.999Z'),
      list: [{ at: new Date('2026-01-01T00:00:00.000Z') }],
    }
    expect(reviveDates(serializeForPayload(original))).toEqual(original)
  })
})

describe('parsePayload', () => {
  const schema = z.object({ at: z.date(), name: z.string() })

  it('revive してから parse する', () => {
    const result = parsePayload(schema, { at: '2026-07-06T01:23:45.678Z', name: 'x' })
    expect(result.at).toBeInstanceOf(Date)
  })

  it('payload 破損（スキーマ不一致）は ZodError をそのまま伝播する', () => {
    expect(() => parsePayload(schema, { at: 'broken', name: 'x' })).toThrow(z.ZodError)
  })
})
