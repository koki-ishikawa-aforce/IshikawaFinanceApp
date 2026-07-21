'use client'

import type { ReactNode } from 'react'
import { useAuth } from './AuthProvider'
import { isLiffEnabled } from '@/lib/liff'
import { LoginScreen } from './LoginScreen'

export function AuthGate({ children }: { children: ReactNode }) {
  const { initialized, loggedIn } = useAuth()

  if (!isLiffEnabled()) {
    return <>{children}</>
  }

  if (!initialized) {
    return null
  }

  if (!loggedIn) {
    return <LoginScreen />
  }

  return <>{children}</>
}
