import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.resetModules() 後もモジュール再評価で同一インスタンスが返るよう hoisted で共有する
const liffMock = vi.hoisted(() => ({
  init: vi.fn(),
}))

vi.mock('@line/liff', () => ({ default: liffMock }))

type LiffLib = typeof import('../liff')
let lib: LiffLib

beforeEach(async () => {
  vi.clearAllMocks()
  process.env['NEXT_PUBLIC_LIFF_ID'] = 'liff-test-id'
  // liff.ts はモジュールレベルで initialized / initPromise を持つため、テストごとに
  // 読み直して初期状態に戻す
  vi.resetModules()
  lib = await import('../liff')
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env['NEXT_PUBLIC_LIFF_ID']
})

describe('initLiff', () => {
  it('liff.init() が打ち切り時間内に終わらないと LiffInitTimeoutError で打ち切る(#577)', async () => {
    vi.useFakeTimers()
    liffMock.init.mockReturnValue(new Promise(() => {}))

    const request = lib.initLiff()
    const caught = request.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(15_000)

    expect(await caught).toBeInstanceOf(lib.LiffInitTimeoutError)
  })

  it('打ち切りより前に成功すれば解決する', async () => {
    vi.useFakeTimers()
    liffMock.init.mockReturnValue(new Promise<void>(resolve => setTimeout(resolve, 15_000 - 1)))

    const request = lib.initLiff()
    await vi.advanceTimersByTimeAsync(15_000 - 1)

    await expect(request).resolves.toBeUndefined()
  })

  it('打ち切り後に liff.init() が裏で成功しても、liff.init() を呼び直さず次の呼び出しが解決する(#577)', async () => {
    vi.useFakeTimers()
    let resolveInit: () => void = () => {}
    liffMock.init.mockReturnValue(
      new Promise<void>(resolve => {
        resolveInit = resolve
      }),
    )

    const first = lib.initLiff()
    const firstCaught = first.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await firstCaught).toBeInstanceOf(lib.LiffInitTimeoutError)

    // 電波が復旧し、裏で動き続けていた liff.init() が成功する
    resolveInit()

    // 再読み込み: liff.init() を呼び直さず、裏の結果で解決する
    await expect(lib.initLiff()).resolves.toBeUndefined()
    expect(liffMock.init).toHaveBeenCalledTimes(1)
  })

  it('liff.init() がタイムアウトではなく失敗した場合は、次の呼び出しで liff.init() をやり直す', async () => {
    liffMock.init.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)

    await expect(lib.initLiff()).rejects.toThrow('boom')
    await expect(lib.initLiff()).resolves.toBeUndefined()
    expect(liffMock.init).toHaveBeenCalledTimes(2)
  })
})
