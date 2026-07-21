'use client'

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { initLiff, isLoggedIn, login, logout, getIdToken, isLiffEnabled } from '@/lib/liff'

interface AuthState {
  initialized: boolean
  loggedIn: boolean
  idToken: string | null
  login: () => void
  logout: () => void
}

const AuthContext = createContext<AuthState>({
  initialized: false,
  loggedIn: false,
  idToken: null,
  login: () => {},
  logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initialized, setInitialized] = useState(false)
  const [loggedIn, setLoggedIn] = useState(false)
  const [idToken, setIdToken] = useState<string | null>(null)

  useEffect(() => {
    if (!isLiffEnabled()) {
      setInitialized(true)
      return
    }

    initLiff()
      .then(() => {
        setInitialized(true)
        if (isLoggedIn()) {
          setLoggedIn(true)
          setIdToken(getIdToken())
        }
      })
      .catch(err => {
        console.error('LIFF initialization failed:', err)
        setInitialized(true)
      })
  }, [])

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
