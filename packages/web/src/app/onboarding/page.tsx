'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useViewerRole } from '@/hooks/useViewerRole'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

/**
 * オンボーディングフロー（Phase1 → Phase2）。
 *
 * オンボーディング専用のバックエンド API は未実装のため、進捗は
 * localStorage に保持する。配偶者完了検知（SpouseCompletionQuery）と
 * Gmail OAuth はエンドポイント実装後にこの画面へ接続する。
 */

const STORAGE_KEY = 'warimaru.onboarding.v1'

interface OnboardingState {
  nickname: string
  nicknameDone: boolean
  lineFriendAdded: boolean
  talkRoomJoined: boolean
  notificationsEnabled: boolean | null
  spouseConfirmed: boolean
  sectionADone: boolean
  sectionBDone: boolean
  sectionFDone: boolean | 'skipped'
}

const INITIAL_STATE: OnboardingState = {
  nickname: '',
  nicknameDone: false,
  lineFriendAdded: false,
  talkRoomJoined: false,
  notificationsEnabled: null,
  spouseConfirmed: false,
  sectionADone: false,
  sectionBDone: false,
  sectionFDone: false,
}

function loadState(): OnboardingState {
  if (typeof window === 'undefined') return INITIAL_STATE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return INITIAL_STATE
    return { ...INITIAL_STATE, ...(JSON.parse(raw) as Partial<OnboardingState>) }
  } catch {
    return INITIAL_STATE
  }
}

type StepId =
  | 'nickname'
  | 'line_friend'
  | 'talk_room'
  | 'notifications'
  | 'spouse_wait'
  | 'phase2'

const PHASE1_STEPS: { id: StepId; label: string }[] = [
  { id: 'nickname', label: 'ニックネーム' },
  { id: 'line_friend', label: '友だち追加' },
  { id: 'talk_room', label: 'トークルーム' },
  { id: 'notifications', label: '通知設定' },
  { id: 'spouse_wait', label: '配偶者待ち' },
  { id: 'phase2', label: 'Phase 2' },
]

function currentStep(state: OnboardingState): StepId {
  if (!state.nicknameDone) return 'nickname'
  if (!state.lineFriendAdded) return 'line_friend'
  if (!state.talkRoomJoined) return 'talk_room'
  if (state.notificationsEnabled === null) return 'notifications'
  if (!state.spouseConfirmed) return 'spouse_wait'
  return 'phase2'
}

export default function OnboardingPage() {
  const { data: me } = useViewerRole()
  const [state, setState] = useState<OnboardingState>(INITIAL_STATE)
  const [loaded, setLoaded] = useState(false)
  const [nicknameInput, setNicknameInput] = useState('')

  useEffect(() => {
    const restored = loadState()
    setState(restored)
    setNicknameInput(restored.nickname)
    setLoaded(true)
  }, [])

  const update = (patch: Partial<OnboardingState>) => {
    setState(prev => {
      const next = { ...prev, ...patch }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  if (!loaded) return null

  const step = currentStep(state)
  const stepIndex = PHASE1_STEPS.findIndex(s => s.id === step)
  const avatar = me?.role === 'honey' ? '⛵' : '🌸'

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>はじめての設定</h1>

      <div className={styles.stepper}>
        {PHASE1_STEPS.map((s, i) => (
          <div
            key={s.id}
            className={
              i < stepIndex
                ? `${styles.stepDot} ${styles.stepDone}`
                : i === stepIndex
                  ? `${styles.stepDot} ${styles.stepActive}`
                  : styles.stepDot
            }
          >
            <span className={styles.stepIndex}>{i < stepIndex ? '✓' : i + 1}</span>
            <span className={styles.stepLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      {step === 'nickname' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>{avatar}</div>
          <span className={ui.sectionTitle}>ニックネームを設定</span>
          <p className={styles.note}>アプリ内で表示される呼び名を決めましょう。</p>
          <input
            className={ui.input}
            value={nicknameInput}
            onChange={e => setNicknameInput(e.target.value)}
            placeholder="例: はにー"
            maxLength={20}
          />
          <button
            className={ui.button}
            disabled={nicknameInput.trim() === ''}
            onClick={() => update({ nickname: nicknameInput.trim(), nicknameDone: true })}
          >
            決定して次へ
          </button>
        </div>
      )}

      {step === 'line_friend' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>💬</div>
          <span className={ui.sectionTitle}>LINE 公式アカウントを友だち追加</span>
          <p className={styles.note}>
            通知の受け取りに使う「わりまる」公式アカウントを LINE で友だち追加してください。
          </p>
          <button className={ui.buttonGhost} onClick={() => update({ lineFriendAdded: true })}>
            友だち追加しました
          </button>
          <button className={styles.backLink} onClick={() => update({ nicknameDone: false })}>
            ← 戻る
          </button>
        </div>
      )}

      {step === 'talk_room' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>👥</div>
          <span className={ui.sectionTitle}>トークルームへ参加</span>
          <p className={styles.note}>
            ふたりの家計通知が届く共有トークルームに参加してください。招待リンクは配偶者または公式アカウントのメッセージから開けます。
          </p>
          <button className={ui.buttonGhost} onClick={() => update({ talkRoomJoined: true })}>
            参加しました
          </button>
          <button className={styles.backLink} onClick={() => update({ lineFriendAdded: false })}>
            ← 戻る
          </button>
        </div>
      )}

      {step === 'notifications' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>🔔</div>
          <span className={ui.sectionTitle}>通知の設定</span>
          <p className={styles.note}>
            リマインダーやレポート完成の通知を LINE で受け取りますか？あとから設定で変更できます。
          </p>
          <button className={ui.button} onClick={() => update({ notificationsEnabled: true })}>
            通知を受け取る
          </button>
          <button
            className={ui.buttonGhost}
            onClick={() => update({ notificationsEnabled: false })}
          >
            今は受け取らない
          </button>
          <button className={styles.backLink} onClick={() => update({ talkRoomJoined: false })}>
            ← 戻る
          </button>
        </div>
      )}

      {step === 'spouse_wait' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>⏳</div>
          <span className={ui.sectionTitle}>配偶者の設定完了を待っています</span>
          <p className={styles.note}>
            ふたりとも Phase 1 の設定を終えると次に進めます。画面を開き直すと最新の状態を確認します（配偶者完了検知 API の接続は準備中です）。
          </p>
          <button className={ui.button} onClick={() => update({ spouseConfirmed: true })}>
            配偶者も完了しています
          </button>
          <button
            className={styles.backLink}
            onClick={() => update({ notificationsEnabled: null })}
          >
            ← 戻る
          </button>
        </div>
      )}

      {step === 'phase2' && (
        <>
          <div className={ui.card}>
            <span className={ui.sectionTitle}>Phase 2 の進捗</span>
            <p className={styles.note}>
              データ連携と初期設定を進めましょう。A → B の順で完了する必要があります。F はスキップできます。
            </p>

            <div className={styles.sectionRow}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionBadge}>A</span>
                <span className={styles.sectionName}>Gmail 連携</span>
                {state.sectionADone ? (
                  <span className={ui.badgeAccent}>完了</span>
                ) : (
                  <span className={ui.badge}>未完了</span>
                )}
              </div>
              <p className={styles.note}>
                利用明細メールの自動取込に使います。OAuth 連携フローはバックエンド実装後に有効になります。
              </p>
              {!state.sectionADone && (
                <button className={ui.buttonGhost} onClick={() => update({ sectionADone: true })}>
                  連携済みにする
                </button>
              )}
            </div>

            <div className={styles.sectionRow}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionBadge}>B</span>
                <span className={styles.sectionName}>初期残高の登録</span>
                {state.sectionBDone ? (
                  <span className={ui.badgeAccent}>完了</span>
                ) : (
                  <span className={ui.badge}>未完了</span>
                )}
              </div>
              <p className={styles.note}>口座の現在残高を登録して資産管理を始めます。</p>
              {!state.sectionBDone && (
                <button
                  className={ui.buttonGhost}
                  disabled={!state.sectionADone}
                  onClick={() => update({ sectionBDone: true })}
                >
                  {state.sectionADone ? '登録済みにする' : 'A の完了後に登録できます'}
                </button>
              )}
            </div>

            <div className={styles.sectionRow}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionBadge}>F</span>
                <span className={styles.sectionName}>マスタのカスタマイズ</span>
                {state.sectionFDone === true && <span className={ui.badgeAccent}>完了</span>}
                {state.sectionFDone === 'skipped' && <span className={ui.badge}>スキップ</span>}
                {state.sectionFDone === false && <span className={ui.badge}>未完了</span>}
              </div>
              <p className={styles.note}>カテゴリや経費種別を好みに合わせて調整します（任意）。</p>
              {state.sectionFDone === false && (
                <div className={ui.row}>
                  <Link href="/settings" className={ui.buttonGhost}>
                    設定を開く
                  </Link>
                  <button className={ui.buttonGhost} onClick={() => update({ sectionFDone: true })}>
                    完了にする
                  </button>
                  <button
                    className={styles.backLink}
                    onClick={() => update({ sectionFDone: 'skipped' })}
                  >
                    スキップ
                  </button>
                </div>
              )}
            </div>
          </div>

          {state.sectionADone && state.sectionBDone && state.sectionFDone !== false && (
            <div className={ui.card}>
              <div className={styles.stepAvatar}>🎉</div>
              <span className={ui.sectionTitle}>設定完了！</span>
              <p className={styles.note}>
                {state.nickname !== '' ? `${state.nickname}さん、` : ''}
                おつかれさまでした。ダッシュボードから家計管理を始めましょう。
              </p>
              <Link href="/" className={ui.button} style={{ textAlign: 'center' }}>
                ダッシュボードへ
              </Link>
            </div>
          )}
        </>
      )}
    </main>
  )
}
