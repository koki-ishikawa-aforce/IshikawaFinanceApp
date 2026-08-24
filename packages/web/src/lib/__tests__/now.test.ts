import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentDate } from '../now'

/** 端末の現在時刻。これと違う値が返れば「固定値が効いた」と言える */
const REAL_NOW = new Date('2026-08-24T10:00:00+09:00')

function freezeRealClock() {
  vi.useFakeTimers()
  vi.setSystemTime(REAL_NOW)
}

describe('currentDate', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('モック起動モードでなければ端末の現在時刻を返す', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '')

    expect(currentDate()).toEqual(REAL_NOW)
  })

  it('モック起動モードで固定日時が指定されていれば、その日時を返す', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', '2026-07-24T12:00:00+09:00')

    expect(currentDate()).toEqual(new Date('2026-07-24T12:00:00+09:00'))
  })

  // 否定形。この分岐が通常ビルドまで効くと、利用者の画面が過去の日付で止まる
  it('モック起動モードでなければ、固定日時が指定されていても無視する', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', '2026-07-24T12:00:00+09:00')

    expect(currentDate()).toEqual(REAL_NOW)
  })

  it('固定日時が空文字なら端末の現在時刻を返す', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', '')

    expect(currentDate()).toEqual(REAL_NOW)
  })

  // 指定ミスで Invalid Date を配ると、日付を使う画面が一斉に壊れて原因が読めなくなる
  it('固定日時が解釈できない値なら端末の現在時刻へ落とす', () => {
    freezeRealClock()
    vi.stubEnv('NEXT_PUBLIC_MOCK', '1')
    vi.stubEnv('NEXT_PUBLIC_MOCK_NOW', '来月')

    expect(currentDate()).toEqual(REAL_NOW)
  })
})
