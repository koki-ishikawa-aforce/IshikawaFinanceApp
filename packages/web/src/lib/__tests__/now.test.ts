import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOCK_NOW } from '@/mocks/clock'
import { now } from '../now'

/** 端末の現在時刻。これと違う値が返れば「固定値が効いた」と言える */
const REAL_NOW = new Date('2026-08-24T10:00:00+09:00')

function freezeRealClock() {
  vi.useFakeTimers()
  vi.setSystemTime(REAL_NOW)
}

describe('now', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('モック起動モードで固定日時が指定されていれば、その日時を返す', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', MOCK_NOW)

    // 期待値は実装と同じ式（`new Date(指定値)`）で組み立てず、絶対時刻で書く。
    // 同じ式で作ると、時間帯の解釈を間違えてもテストが同じ間違いをして一致する
    expect(now().toISOString()).toBe('2026-07-24T03:00:00.000Z')
  })

  // 否定形。この分岐が通常ビルドまで効くと、利用者の画面が過去の日付で止まる
  it('モック起動モードでなければ、固定日時が指定されていても無視する', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', MOCK_NOW)

    expect(now()).toEqual(REAL_NOW)
  })

  it('固定日時が指定されていなければ端末の現在時刻を返す', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', undefined)

    expect(now()).toEqual(REAL_NOW)
  })

  it('固定日時が空文字なら端末の現在時刻を返す', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', '')

    expect(now()).toEqual(REAL_NOW)
  })

  // 指定ミスで Invalid Date を配ると、日付を使う画面が一斉に壊れて原因が読めなくなる
  it('固定日時が解釈できない値なら端末の現在時刻へ落とす', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', '来月')

    expect(now()).toEqual(REAL_NOW)
  })

  // 日付だけを渡すと UTC の深夜として解釈され、JST では 9 時間ずれる。指定は日時で書く
  // （README にもそう書いてある）ことを、この振る舞いの固定で示す
  it('日付だけを渡すと UTC の深夜として解釈される', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', '2026-07-24')

    expect(now().toISOString()).toBe('2026-07-24T00:00:00.000Z')
  })
})
