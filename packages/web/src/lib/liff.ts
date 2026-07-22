import liff from '@line/liff'

const LIFF_ID = process.env['NEXT_PUBLIC_LIFF_ID'] ?? ''

let initialized = false

export async function initLiff(): Promise<void> {
  if (initialized) return
  if (!LIFF_ID) {
    console.warn('NEXT_PUBLIC_LIFF_ID is not set — LIFF disabled')
    return
  }
  await liff.init({ liffId: LIFF_ID })
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

/**
 * LIFF context からトークルーム（グループ / 複数人トーク）の ID を得る。
 * 1:1 トークや外部ブラウザで開いた場合は null。
 */
export function getTalkRoomContextId(): string | null {
  if (!LIFF_ID || !initialized) return null
  const context = liff.getContext()
  if (context === null) return null
  if (context.type === 'group') return context.groupId ?? null
  if (context.type === 'room') return context.roomId ?? null
  return null
}

/** OS 標準ブラウザで URL を開く（Gmail OAuth は LIFF 内ブラウザでは認可できない、OQ-7） */
export function openExternal(url: string): void {
  if (LIFF_ID && initialized && liff.isInClient()) {
    liff.openWindow({ url, external: true })
    return
  }
  window.open(url, '_blank', 'noopener')
}
