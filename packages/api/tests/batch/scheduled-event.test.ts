/**
 * スケジュール起動イベントの読み取り（#416）のテスト。
 *
 * ここで効かせたいのは「黙って既定値に落とさない」こと。上書きの書式が違うまま既定値で
 * 走ると、意図と違う月・違う期間を処理した結果が成功として残る。
 */
import { describe, it, expect } from 'vitest'
import { readScheduledBatchEvent } from '../../src/batch/scheduled-event.js'

const NOW = new Date('2026-08-05T00:00:00+09:00')
const now = (): Date => NOW

describe('readScheduledBatchEvent', () => {
  it('EventBridge の発火時刻を処理の基準時刻に使う', () => {
    const input = readScheduledBatchEvent(
      { 'detail-type': 'Scheduled Event', time: '2026-08-01T15:00:00Z', detail: {} },
      now,
    )

    expect(input.at).toEqual(new Date('2026-08-01T15:00:00Z'))
    expect(input.overrides).toEqual({})
  })

  it('オフセット付きの時刻表記も受ける（手動起動で JST のまま指定できるように）', () => {
    expect(readScheduledBatchEvent({ time: '2026-08-01T00:00:00+09:00' }, now).at).toEqual(
      new Date('2026-07-31T15:00:00Z'),
    )
  })

  it('時刻として読めない文字列を受け付けない', () => {
    expect(() => readScheduledBatchEvent({ time: '2026-08-01' }, now)).toThrow(/書式が不正/)
  })

  it('発火時刻が無いイベントは実行時刻を基準にする', () => {
    expect(readScheduledBatchEvent({ detail: {} }, now).at).toEqual(NOW)
    expect(readScheduledBatchEvent(undefined, now).at).toEqual(NOW)
  })

  it('detail の対象年月・さかのぼり日数を取り出す', () => {
    const input = readScheduledBatchEvent(
      { time: '2026-08-01T15:00:00Z', detail: { targetYearMonth: '2026-08', scanDays: 7 } },
      now,
    )

    expect(input.overrides).toEqual({ targetYearMonth: '2026-08', scanDays: 7 })
  })

  it('知らないキーが混ざったイベントを受け付けない', () => {
    expect(() => readScheduledBatchEvent({ detail: { targetMonth: '2026-08' } }, now)).toThrow(
      /書式が不正/,
    )
  })

  it.each(['targetYearMonth', 'scanDays'])(
    '上書きを detail の外に書いたイベントを受け付けない: %s',
    key => {
      // 素通しすると、書き間違えた上書きが無視されたまま既定値で「成功」してしまう
      expect(() => readScheduledBatchEvent({ [key]: '2026-08' }, now)).toThrow(/書式が不正/)
    },
  )

  it('EventBridge の封筒（読まないフィールド）は素通しする', () => {
    expect(() =>
      readScheduledBatchEvent(
        {
          version: '0',
          id: 'cdc73f9d-aea9-11e3-9d5a-835b769c0d9c',
          'detail-type': 'Scheduled Event',
          source: 'aws.events',
          account: '123456789012',
          time: '2026-08-01T15:00:00Z',
          region: 'ap-northeast-1',
          resources: ['arn:aws:events:ap-northeast-1:123456789012:rule/daily'],
          detail: {},
        },
        now,
      ),
    ).not.toThrow()
  })

  it('対象年月の書式違いを受け付けない', () => {
    expect(() => readScheduledBatchEvent({ detail: { targetYearMonth: '2026/08' } }, now)).toThrow(
      /書式が不正/,
    )
  })

  it.each([0, -1, 1.5, '5'])('さかのぼり日数が正の整数でなければ受け付けない: %s', value => {
    expect(() => readScheduledBatchEvent({ detail: { scanDays: value } }, now)).toThrow(
      /書式が不正/,
    )
  })

  it('例外にイベントの中身そのものを載せない（ターゲット入力は運用者が自由に書けるため）', () => {
    try {
      readScheduledBatchEvent({ detail: { targetYearMonth: 'secret-value' } }, now)
      expect.unreachable('例外が投げられていない')
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).name).toBe('InvalidScheduledBatchEventError')
      expect((e as Error).message).not.toContain('secret-value')
      expect((e as Error).message).toContain('detail.targetYearMonth')
    }
  })
})
