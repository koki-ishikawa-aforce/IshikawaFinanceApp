import type { Metadata } from 'next'
import { Zen_Maru_Gothic } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

const zenMaruGothic = Zen_Maru_Gothic({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-zen-maru',
})

export const metadata: Metadata = {
  title: 'わりまる',
  description: '家計管理アプリ',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" data-theme="darling" className={zenMaruGothic.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
