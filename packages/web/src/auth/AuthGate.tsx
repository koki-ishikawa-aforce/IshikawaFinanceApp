'use client'

import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { isLiffEnabled } from '@/lib/liff'
import { LoginScreen } from './LoginScreen'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import { NETWORK_ERROR_MESSAGE } from '@/lib/api-client'
import screen from './authScreen.module.css'

export function AuthGate({ children }: { children: ReactNode }) {
  const { initialized, loggedIn, initTimedOut, retryInit } = useAuth()

  if (!isLiffEnabled()) {
    return <>{children}</>
  }

  // liff.init() が打ち切り時間内に終わらなかった(#577)。圏外で開いたまま何も出ない
  // 白画面にしないよう、通信できないときの共通文言と再読み込みの手段を出す
  if (initTimedOut) {
    return (
      <main className={screen.container}>
        <div className={screen.card}>
          <ErrorState onRetry={retryInit}>{NETWORK_ERROR_MESSAGE}</ErrorState>
        </div>
      </main>
    )
  }

  if (!initialized) {
    return (
      <main className={screen.container}>
        <div className={screen.card}>
          {/* アプリ起動直後の全画面フォールバック。他画面の同種フォールバック
              (onboarding/accounts/balances 等)と同じく announce しない */}
          <LoadingState announce={false} />
        </div>
      </main>
    )
  }

  if (!loggedIn) {
    return <LoginScreen />
  }

  return <>{children}</>
}
