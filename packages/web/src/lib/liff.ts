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

/** liff.init() が打ち切り時間内に終わらなかったことを表す(#577) */
export class LiffInitTimeoutError extends Error {
  constructor() {
    super('LIFF init timed out')
    this.name = 'LiffInitTimeoutError'
  }
}

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
  await withInitTimeout(liff.init({ liffId: LIFF_ID }))
  initialized = true
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
