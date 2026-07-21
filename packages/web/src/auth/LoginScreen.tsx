'use client'

import { useAuth } from './AuthProvider'
import styles from './LoginScreen.module.css'

export function LoginScreen() {
  const { login } = useAuth()

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>わりまる</h1>
        <p className={styles.subtitle}>家計管理アプリ</p>
        <button className={styles.loginButton} onClick={login}>
          LINE でログイン
        </button>
      </div>
    </main>
  )
}
