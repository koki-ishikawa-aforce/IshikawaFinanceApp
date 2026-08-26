import liff from '@line/liff'

const LIFF_ID = process.env['NEXT_PUBLIC_LIFF_ID'] ?? ''

/**
 * LIFF 初期化の打ち切り時間。
 *
 * 圏外でアプリを開くと liff.init() は resolve も reject もせず止まり、AuthGate が
 * 永久に何も表示しないまま止まる(#577)。api-client の通常リクエストの打ち切り時間
 * (DEFAULT_TIMEOUT_MS)と同じ値で打ち切り、失敗として扱う。
 */
const LIFF_INIT_TIMEOUT_MS = 15_000

let initialized = false
/**
 * 進行中の liff.init() 呼び出し。打ち切り後も liff.init() 自体は中断できず裏で
 * 動き続けるため(LIFF SDK に AbortSignal 相当の中断手段が無い)、キャッシュして
 * 再読み込み(retryInit)のたびに liff.init() を重ねて呼ばないようにする(#577)
 */
let initPromise: Promise<void> | null = null

/** liff.init() が打ち切り時間内に終わらなかったことを表す(#577) */
export class LiffInitTimeoutError extends Error {
  constructor() {
    super('LIFF init timed out')
    this.name = 'LiffInitTimeoutError'
  }
}

/**
 * liff.init() を開始し、結果をキャッシュする。
 *
 * 呼び出し中に打ち切り(LiffInitTimeoutError)が起きても、この Promise 自体は
 * liff.init() の実際の結果(成功/失敗)で確定させる。initialized フラグは
 * 「タイムアウトを検知したか」ではなく「liff.init() が実際に成功したか」に
 * 紐づける。失敗(タイムアウト以外の reject)時はキャッシュを捨て、次の呼び出しで
 * 新しい liff.init() をやり直せるようにする
 */
function runLiffInit(): Promise<void> {
  if (!initPromise) {
    initPromise = liff.init({ liffId: LIFF_ID }).then(
      () => {
        initialized = true
      },
      err => {
        initPromise = null
        throw err
      },
    )
  }
  return initPromise
}

/**
 * api-client.ts の withTimeout と役割は似ているが、共通化はしない。fetch と違い
 * liff.init() には中断手段(AbortSignal 相当)が無く、打ち切ってもこの関数に渡した
 * promise 自体は動き続ける(結果は runLiffInit がキャッシュで拾う)。「中断できる/
 * できない」という前提の違いを1つの関数に畳み込むと、それぞれの呼び出し側が
 * どちらの前提で書かれているか読み取りにくくなる
 */
function withInitTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new LiffInitTimeoutError()), LIFF_INIT_TIMEOUT_MS)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export async function initLiff(): Promise<void> {
  if (initialized) return
  if (!LIFF_ID) {
    console.warn('NEXT_PUBLIC_LIFF_ID is not set — LIFF disabled')
    return
  }
  await withInitTimeout(runLiffInit())
}

export function isLoggedIn(): boolean {
  if (!LIFF_ID) return false
  return liff.isLoggedIn()
}

export function login(): void {
  liff.login()
}

export function logout(): void {
  liff.logout()
}

export function getIdToken(): string | null {
  return liff.getIDToken()
}

export function isInClient(): boolean {
  return liff.isInClient()
}

export function isLiffEnabled(): boolean {
  return LIFF_ID !== ''
}

/** OS 標準ブラウザで URL を開く（Gmail OAuth は LIFF 内ブラウザでは認可できない、OQ-7） */
export function openExternal(url: string): void {
  if (LIFF_ID && initialized && liff.isInClient()) {
    liff.openWindow({ url, external: true })
    return
  }
  window.open(url, '_blank', 'noopener')
}
