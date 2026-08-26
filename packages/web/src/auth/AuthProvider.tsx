'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  initLiff,
  isLoggedIn,
  login,
  logout,
  getIdToken,
  isLiffEnabled,
  LiffInitTimeoutError,
} from '@/lib/liff'

interface AuthState {
  initialized: boolean
  loggedIn: boolean
  idToken: string | null
  /** liff.init() が打ち切り時間内に終わらなかった場合に立つ(#577)。retryInit でやり直せる */
  initTimedOut: boolean
  retryInit: () => void
  login: () => void
  logout: () => void
}

const AuthContext = createContext<AuthState>({
  initialized: false,
  loggedIn: false,
  idToken: null,
  initTimedOut: false,
  retryInit: () => {},
  login: () => {},
  logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialized, setInitialized] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [idToken, setIdToken] = useState<string | null>(null)
  const [initTimedOut, setInitTimedOut] = useState(false)

  const runInit = useCallback(() => {
    setInitTimedOut(false)
    initLiff()
      .then(() => {
        setInitialized(true)
        if (isLoggedIn()) {
          setLoggedIn(true)
          setIdToken(getIdToken())
        }
      })
      .catch(err => {
        if (err instanceof LiffInitTimeoutError) {
          setInitTimedOut(true)
          return
        }
        console.error('LIFF initialization failed:', err)
        setInitialized(true)
      })
  }, [])

  useEffect(() => {
    if (!isLiffEnabled()) {
      setInitialized(true)
      return
    }
    runInit()
  }, [runInit])

  const handleLogin = useCallback(() => login(), [])
  const handleLogout = useCallback(() => {
    logout()
    setLoggedIn(false)
    setIdToken(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        initialized,
        loggedIn,
        idToken,
        initTimedOut,
        retryInit: runInit,
        login: handleLogin,
        logout: handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
