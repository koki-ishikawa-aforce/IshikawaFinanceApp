import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'わりまる',
  description: '家計管理アプリ',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" data-theme="darling">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
