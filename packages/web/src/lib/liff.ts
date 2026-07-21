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
