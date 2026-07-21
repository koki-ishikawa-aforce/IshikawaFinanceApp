'use client'

import { createContext, useContext, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useViewerRole } from '@/hooks/useViewerRole'
import type { Theme } from './tokens'

const ThemeContext = createContext<Theme>('darling')

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data } = useViewerRole()
  const theme: Theme = data?.role ?? 'darling'

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
  }, [theme])

  return <ThemeContext value={theme}>{children}</ThemeContext>
}
