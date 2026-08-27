import { afterEach, describe, expect, it, vi } from 'vitest'
import { YearMonthSchema } from '@warimaru/domain'
import {
  formatDate,
  formatDateWithYear,
  formatMonthLabel,
  getCurrentMonth,
  shiftMonth,
} from '../month'
import { now } from '../now'

// 「今」の取り方は now() の責務なので、ここでは差し替えられる形にして委譲だけを見る
// (環境変数の名前など now() の内側の取り決めをこのファイルに持ち込まない)。
// 既定では本物に委ねるため、偽の時計を使う下のテストはそのまま動く
vi.mock('../now', async importOriginal => {
  const actual = await importOriginal<typeof import('../now')>()
  return { now: vi.fn(actual.now) }
})

const ym = (value: string) => YearMonthSchema.parse(value)

describe('getCurrentMonth', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('現在日時を YYYY-MM 形式で返す', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-22T10:00:00'))
    expect(getCurrentMonth()).toBe('2026-07')
  })

  it('1桁の月をゼロ埋めする', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T00:00:00'))
    expect(getCurrentMonth()).toBe('2026-03')
  })

  // 月の境界は JST で決まる(usability 5-4)。UTC 基準で判定すると、月末の 15:00Z 以降に
  // 開いた画面だけ前月のままになる
  it('JST で月が替わる瞬間から翌月を返す', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T15:00:00.000Z'))
    expect(getCurrentMonth()).toBe('2026-08')
  })

  it('JST で月が替わる 1 分前はまだ当月を返す', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T14:59:00.000Z'))
    expect(getCurrentMonth()).toBe('2026-07')
  })

  // 見た目の自動チェックは「当月」で表示が変わる画面を撮る(#506)。委譲が切れると、
  // 固定した日時がここまで届かず、月が替わるたび基準画像がずれる状態に戻る
  it('「今」の取得を now() に委ねる', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T10:00:00+09:00'))
    vi.mocked(now).mockReturnValueOnce(new Date('2026-07-24T12:00:00+09:00'))

    expect(getCurrentMonth()).toBe('2026-07')
  })

  // 端末の時間帯設定によらず「今月」は JST で決まる(#639)。端末時間帯まかせだと、
  // この瞬間はロサンゼルス(UTC-7/8)では 7/31 のままで、当月判定が 1 か月ずれる
  it('端末の時間帯設定によらず JST で当月を判定する', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T15:00:00.000Z'))
    vi.stubEnv('TZ', 'America/Los_Angeles')

    expect(getCurrentMonth()).toBe('2026-08')
  })
})

describe('shiftMonth', () => {
  it('月を進める', () => {
    expect(shiftMonth(ym('2026-07'), 1)).toBe('2026-08')
  })

  it('月を戻す', () => {
    expect(shiftMonth(ym('2026-07'), -1)).toBe('2026-06')
  })

  it('年をまたいで進める', () => {
    expect(shiftMonth(ym('2026-12'), 1)).toBe('2027-01')
  })

  it('年をまたいで戻す', () => {
    expect(shiftMonth(ym('2026-01'), -1)).toBe('2025-12')
  })

  it('12ヶ月を超える delta を処理する', () => {
    expect(shiftMonth(ym('2026-07'), 18)).toBe('2028-01')
    expect(shiftMonth(ym('2026-07'), -19)).toBe('2024-12')
  })
})

describe('formatMonthLabel', () => {
  it('YYYY年M月 形式で整形する(ゼロ埋めなし)', () => {
    expect(formatMonthLabel(ym('2026-07'))).toBe('2026年7月')
    expect(formatMonthLabel(ym('2026-12'))).toBe('2026年12月')
  })
})

describe('formatDate / formatDateWithYear', () => {
  it('M/D 形式で整形する', () => {
    expect(formatDate(new Date(2026, 6, 22))).toBe('7/22')
  })

  it('月内の日付はゼロ埋めしない(年つきの表記と使い分ける)', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('1/5')
  })

  it('YYYY/MM/DD 形式で整形する(usability 5-4)', () => {
    expect(formatDateWithYear(new Date(2026, 6, 22))).toBe('2026/07/22')
  })

  it('1 桁の月・日をゼロ埋めする', () => {
    expect(formatDateWithYear(new Date(2026, 0, 5))).toBe('2026/01/05')
  })

  it('2 桁の月・日はそのまま並べる', () => {
    expect(formatDateWithYear(new Date(2026, 11, 31))).toBe('2026/12/31')
  })

  // 記録の時刻(取込完了・確定・最終更新)は UTC で届く。表示は JST の暦日で決める(usability 5-4)
  it('UTC の時刻を JST の暦日として整形する', () => {
    expect(formatDateWithYear(new Date('2026-07-18T14:59:00.000Z'))).toBe('2026/07/18')
    expect(formatDateWithYear(new Date('2026-07-18T15:00:00.000Z'))).toBe('2026/07/19')
  })

  it('JST で年をまたぐ時刻は翌年の日付になる', () => {
    expect(formatDateWithYear(new Date('2025-12-31T15:00:00.000Z'))).toBe('2026/01/01')
  })

  // 端末の時間帯が JST でなくても、表示は常に JST の暦日にする(#639)。
  // 端末時間帯まかせだと、この時刻はロサンゼルス(UTC-7/8)では 7/18 のままになる
  it('端末の時間帯設定によらず JST の暦日で整形する', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')

    expect(formatDate(new Date('2026-07-18T15:00:00.000Z'))).toBe('7/19')
    expect(formatDateWithYear(new Date('2026-07-18T15:00:00.000Z'))).toBe('2026/07/19')
  })
})
