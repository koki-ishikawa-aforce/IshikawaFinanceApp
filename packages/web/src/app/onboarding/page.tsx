'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useViewerRole } from '@/hooks/useViewerRole'
import { apiFetch, apiMutate, ApiError } from '@/lib/api-client'
import {
  AccountBalanceListWireSchema,
  GmailAuthorizeResponseSchema,
  ImportStatusResponseSchema,
  LineFriendCheckWireSchema,
  OnboardingMeWireSchema,
  OnboardingUserWireSchema,
  SpouseCompletionResultWireSchema,
  type AppUserWire,
  type LineOperationSettingsWire,
  type SharedTalkRoomWire,
} from '@/lib/api-schemas'
import { getTalkRoomContextId, openExternal } from '@/lib/liff'
import { getCurrentMonth } from '@/lib/month'
import { RoleIcon } from '@/components/ui/RoleIcon'
import {
  LuMessageCircle,
  LuUsers,
  LuBell,
  LuRocket,
  LuPartyPopper,
  LuCheck,
  LuTriangleAlert,
  LuHourglass,
} from '@/components/ui/icons'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

/**
 * オンボーディングフロー（Phase1 → Phase2 → 配偶者完了待ち）。
 *
 * 進捗の正はサーバーの AppUser 集約（GET /api/onboarding/me）。表示ステップは
 * サーバー状態から導出し、各操作はオンボーディング API へ記録する（#42 で
 * localStorage 暫定実装を置き換え）。Phase 遷移は前進のみ（ドメイン不変条件）
 * のため「戻る」導線は持たない。
 *
 * 配偶者完了待ちは Phase2 完了後に置く（08f §2: 配偶者完了検知の事前条件は
 * 「ユーザーが Phase2 を完了し、画面ロード」。論点19: 画面ロード時のみ判定）。
 */

/**
 * 共通トークルーム ID の自己申告値（正は join Webhook — onboarding API 側の暫定契約）。
 * LIFF context（グループ内で開いた場合）を優先し、1:1 トーク・外部ブラウザでは
 * 環境変数の運用ルーム ID を使う。どちらも無ければ null（参加記録は送らない）。
 */
const CONFIGURED_TALK_ROOM_ID = process.env['NEXT_PUBLIC_TALK_ROOM_ID'] ?? null

const EMPTY_LINE_SETTINGS: LineOperationSettingsWire = {
  friendAdd: { kind: 'not_added' },
  notificationActivation: { kind: 'not_activated' },
}

/** 世帯の共通トークルーム参加状態の既定値（読み込み完了前は step 判定に到達しない） */
const NOT_JOINED_TALK_ROOM: SharedTalkRoomWire = { kind: 'not_joined' }

/**
 * ワイヤー形式向けの LINE 運用設定の読取り。
 * @see packages/domain/src/onboarding-auth/aggregates/AppUser.ts の lineOperationSettingsOf
 *     （運用開始済みは集約直下・それ以前は common・未設定は全未着手、と同一規約）
 */
function lineSettingsOf(user: AppUserWire): LineOperationSettingsWire {
  if (user.kind === 'operation_started') return user.lineOperationSettings
  return user.common.lineOperationSettings ?? EMPTY_LINE_SETTINGS
}

type StepId =
  | 'nickname'
  | 'line_friend'
  | 'talk_room'
  | 'notifications'
  | 'phase2'
  | 'spouse_wait'
  | 'done'

const STEPS: { id: StepId; label: string }[] = [
  { id: 'nickname', label: 'ニックネーム' },
  { id: 'line_friend', label: '友だち追加' },
  // 世帯にひとつの事実（OQ-55 ①）なので、自分の操作を指していると読めない「共通」を冠する。
  // 表記はユビキタス言語（docs/domain/08f-ul-オンボーディング認証.md §1「共通トークルーム」）に合わせる
  { id: 'talk_room', label: '共通トークルーム' },
  { id: 'notifications', label: '通知設定' },
  { id: 'phase2', label: 'Phase 2' },
  { id: 'spouse_wait', label: '完了確認' },
]

function currentStep(
  user: AppUserWire | null,
  sharedTalkRoom: SharedTalkRoomWire,
  notificationsDeferred: boolean,
): StepId {
  if (user === null) return 'nickname'
  if (user.kind === 'phase2_in_progress') return 'phase2'
  if (user.kind === 'phase2_completed') return 'spouse_wait'
  if (user.kind === 'operation_started') return 'done'
  if (user.common.nickname === undefined) return 'nickname'
  const settings = lineSettingsOf(user)
  if (settings.friendAdd.kind !== 'added') return 'line_friend'
  // 共通トークルーム参加は世帯にひとつの事実（per-user ではなく世帯の記録を見る）
  if (sharedTalkRoom.kind !== 'joined') return 'talk_room'
  if (settings.notificationActivation.kind !== 'activated' && !notificationsDeferred) {
    return 'notifications'
  }
  return 'phase2'
}

function errorNote(error: unknown): string | null {
  if (error === null || error === undefined) return null
  if (error instanceof ApiError) return error.message
  return error instanceof Error ? error.message : '通信に失敗しました'
}

function ErrorNote({ error }: { error: unknown }) {
  const message = errorNote(error)
  if (message === null) return null
  return (
    <p className={styles.note}>
      <LuTriangleAlert aria-hidden="true" style={{ verticalAlign: 'middle' }} /> {message}
    </p>
  )
}

export default function OnboardingPage() {
  const { data: me } = useViewerRole()
  const queryClient = useQueryClient()
  const [nicknameInput, setNicknameInput] = useState('')
  const [notificationsDeferred, setNotificationsDeferred] = useState(false)

  const meQuery = useQuery({
    queryKey: ['onboarding', 'me'],
    queryFn: () => apiFetch('/api/onboarding/me', OnboardingMeWireSchema),
  })
  const user = meQuery.data?.user ?? null
  const sharedTalkRoom = meQuery.data?.sharedTalkRoom ?? NOT_JOINED_TALK_ROOM

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['onboarding'] })

  const saveNickname = useMutation({
    mutationFn: (nickname: string) =>
      user === null
        ? apiMutate(
            '/api/onboarding/register',
            { method: 'POST', body: { nickname } },
            OnboardingUserWireSchema,
          )
        : apiMutate(
            '/api/onboarding/nickname',
            { method: 'PUT', body: { nickname } },
            OnboardingUserWireSchema,
          ),
    onSuccess: invalidate,
  })

  /**
   * 友だち追加の確認をやり直す（#417 A）。
   * 登録時の照会が失敗した人は「友だち未追加」の扱いのまま止まるため、この入口が唯一の
   * 立て直し経路になる（自己申告ボタンは #298 で廃止される）。
   */
  const checkLineFriend = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/onboarding/phase1/line-friend/check',
        { method: 'POST' },
        LineFriendCheckWireSchema,
      ),
    onSuccess: invalidate,
  })

  const recordLineFriend = useMutation({
    mutationFn: () =>
      apiMutate('/api/onboarding/phase1/line-friend', { method: 'POST' }, OnboardingUserWireSchema),
    onSuccess: invalidate,
  })

  const recordTalkRoom = useMutation({
    mutationFn: (talkRoomId: string) =>
      apiMutate(
        '/api/onboarding/phase1/talk-room',
        { method: 'POST', body: { talkRoomId } },
        OnboardingMeWireSchema,
      ),
    onSuccess: invalidate,
  })

  const activateNotification = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/onboarding/phase1/notification',
        { method: 'POST' },
        OnboardingUserWireSchema,
      ),
    onSuccess: invalidate,
  })

  const startPhase2 = useMutation({
    mutationFn: () =>
      apiMutate('/api/onboarding/phase2/start', { method: 'POST' }, OnboardingUserWireSchema),
    onSuccess: invalidate,
  })

  const gmailAuthorize = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/onboarding/gmail/authorize',
        { method: 'POST' },
        GmailAuthorizeResponseSchema,
      ),
    onSuccess: result => {
      openExternal(result.authorizationUrl)
    },
  })

  const completeSectionB = useMutation({
    mutationFn: (initialBalanceRef: {
      smbcAccountId: string
      otherSavingsAccountId: string
      nisaAccountId: string
    }) =>
      apiMutate(
        '/api/onboarding/phase2/section-b',
        { method: 'PUT', body: { initialBalanceRef } },
        OnboardingUserWireSchema,
      ),
    onSuccess: invalidate,
  })

  const finishSectionF = useMutation({
    mutationFn: (body: { kind: 'completed'; importJobId: string } | { kind: 'skipped' }) =>
      apiMutate(
        '/api/onboarding/phase2/section-f',
        { method: 'PUT', body },
        OnboardingUserWireSchema,
      ),
    onSuccess: invalidate,
  })

  const completePhase2 = useMutation({
    mutationFn: () =>
      apiMutate('/api/onboarding/phase2/complete', { method: 'POST' }, OnboardingUserWireSchema),
    onSuccess: invalidate,
  })

  const progress = user?.kind === 'phase2_in_progress' ? user.progress : undefined
  const needsSectionB = progress?.sectionB.kind === 'not_started'
  const needsSectionF = progress?.sectionF.kind === 'not_started'

  // Section B: 初期残高登録参照は登録済み口座（残高一覧）から組み立てる
  const balancesQuery = useQuery({
    queryKey: ['balances', 'list'],
    queryFn: () => apiFetch('/api/balances', AccountBalanceListWireSchema),
    enabled: needsSectionB,
  })
  const accounts = balancesQuery.data?.items ?? []
  const smbcAccount = accounts.find(item => item.kind === 'smbc_bank')
  const otherSavingsAccount = accounts.find(item => item.kind === 'other_savings')
  const nisaAccount = accounts.find(item => item.kind === 'nisa')
  const initialBalanceRef =
    smbcAccount !== undefined && otherSavingsAccount !== undefined && nisaAccount !== undefined
      ? {
          smbcAccountId: smbcAccount.accountId,
          otherSavingsAccountId: otherSavingsAccount.accountId,
          nisaAccountId: nisaAccount.accountId,
        }
      : null

  // Section F: 今月分の取込完了があれば、その取込ジョブで完了扱いにできる
  const currentMonth = getCurrentMonth()
  const importStatusQuery = useQuery({
    queryKey: ['imports', 'status', currentMonth],
    queryFn: () =>
      apiFetch(`/api/imports/status?month=${currentMonth}`, ImportStatusResponseSchema),
    enabled: needsSectionF,
  })
  const importCompletion = importStatusQuery.data?.completion ?? null

  const spouseQuery = useQuery({
    queryKey: ['onboarding', 'spouse-completion'],
    queryFn: () => apiFetch('/api/onboarding/spouse-completion', SpouseCompletionResultWireSchema),
    enabled: user?.kind === 'phase2_completed',
  })

  if (meQuery.isPending) return null
  if (meQuery.isError) {
    return (
      <main className={styles.main}>
        <h1 className={ui.pageTitle}>はじめての設定</h1>
        <div className={ui.card}>
          <span className={ui.sectionTitle}>読み込みに失敗しました</span>
          <ErrorNote error={meQuery.error} />
          <button className={ui.buttonGhost} onClick={() => void meQuery.refetch()}>
            再読み込み
          </button>
        </div>
      </main>
    )
  }

  const step = currentStep(user, sharedTalkRoom, notificationsDeferred)
  const stepIndex = step === 'done' ? STEPS.length : STEPS.findIndex(s => s.id === step)
  const role = user?.common.role ?? me?.role
  const avatarRole = role === 'honey' ? 'honey' : ('darling' as const)
  const nickname = user?.common.nickname ?? ''
  const spouse = spouseQuery.data
  const talkRoomId = getTalkRoomContextId() ?? CONFIGURED_TALK_ROOM_ID
  /**
   * 直近の確認結果。確認できた回は友だち追加が記録されて次のステップへ進むため、`confirmed` が
   * 見えるのは再取得が終わるまでの短いあいだだけになる。
   *
   * 確認そのものが失敗した場合（通信断・5xx・応答が想定と違う）も `unavailable` に合流させる。
   * 利用者から見れば「LINE へ問い合わせできなかった」という同じ出来事で、次にとる行動も同じため、
   * 同じカードに 2 通りの案内を出さない。
   * 再確認中は前回の結果を消す（古い案内を残したまま新しい確認が走る状態を作らない）。
   */
  const friendCheckResult = checkLineFriend.isPending
    ? null
    : checkLineFriend.isError
      ? 'unavailable'
      : (checkLineFriend.data?.result.kind ?? null)

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>はじめての設定</h1>

      <div className={styles.stepper}>
        {STEPS.map((s, i) => (
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
            <span className={styles.stepIndex}>
              {i < stepIndex ? <LuCheck aria-label="完了" /> : i + 1}
            </span>
            <span className={styles.stepLabel}>{s.label}</span>
          </div>
        ))}
      </div>

      {step === 'nickname' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>
            <RoleIcon role={avatarRole} size="1.5em" />
          </div>
          <span className={ui.sectionTitle}>ニックネームを設定</span>
          <p className={styles.note}>アプリ内で表示される呼び名を決めましょう（10文字まで）。</p>
          <input
            className={ui.input}
            value={nicknameInput}
            onChange={e => setNicknameInput(e.target.value)}
            placeholder="例: はにー"
            maxLength={10}
          />
          <button
            className={ui.button}
            disabled={nicknameInput.trim() === '' || saveNickname.isPending}
            onClick={() => saveNickname.mutate(nicknameInput.trim())}
          >
            決定して次へ
          </button>
          <ErrorNote error={saveNickname.error} />
        </div>
      )}

      {step === 'line_friend' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>
            <LuMessageCircle aria-hidden="true" size="1.5em" />
          </div>
          <span className={ui.sectionTitle}>LINE 公式アカウントを友だち追加</span>
          <p className={styles.note}>
            通知の受け取りに使う「わりまる」公式アカウントを LINE
            で友だち追加してください。追加したら「友だち追加を確認する」を押すと、わりまるが LINE
            に問い合わせて確認します。
          </p>
          <button
            className={ui.button}
            disabled={checkLineFriend.isPending}
            onClick={() => checkLineFriend.mutate()}
          >
            {checkLineFriend.isPending ? '確認中...' : '友だち追加を確認する'}
          </button>
          {/* 確認結果は押した場所で差し替わる。読み上げに載せないと結果が伝わらない（使用性 8-4） */}
          {friendCheckResult === 'confirmed' && (
            <p className={styles.note} role="status">
              <LuCheck aria-hidden="true" style={{ verticalAlign: 'middle' }} />{' '}
              友だち追加を確認しました。次の手順へ進みます。
            </p>
          )}
          {friendCheckResult === 'not_friend' && (
            <p className={styles.note} role="status">
              <LuTriangleAlert aria-hidden="true" style={{ verticalAlign: 'middle' }} />{' '}
              友だち追加を確認できませんでした。LINE
              で「わりまる」を友だち追加してから、もう一度お試しください。
            </p>
          )}
          {friendCheckResult === 'unavailable' && (
            <p className={ui.error} role="alert">
              LINE に問い合わせできませんでした。通信状況を確かめて、もう一度お試しください。
            </p>
          )}
          {/* 自己申告（#298 で廃止予定）。確認が通らないあいだの暫定の逃げ道として残す */}
          <p className={styles.note}>確認がうまくいかないときは、こちらから先へ進めます。</p>
          <button
            className={ui.buttonGhost}
            disabled={recordLineFriend.isPending}
            onClick={() => recordLineFriend.mutate()}
          >
            友だち追加しました
          </button>
          <ErrorNote error={recordLineFriend.error} />
        </div>
      )}

      {step === 'talk_room' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>
            <LuUsers aria-hidden="true" size="1.5em" />
          </div>
          <span className={ui.sectionTitle}>共通トークルームへ参加</span>
          <p className={styles.note}>
            ふたりの家計通知が届く共通トークルームに参加してください。ふたりで共有する設定なので、どちらかが参加を記録すればこの手順は完了します。招待リンクは配偶者または公式アカウントのメッセージから開けます。
          </p>
          {talkRoomId === null && (
            <p className={styles.note}>
              <LuTriangleAlert aria-hidden="true" style={{ verticalAlign: 'middle' }} />{' '}
              参加を記録するトークルームを特定できません。共通トークルーム内からこの画面を開き直してください。
            </p>
          )}
          <button
            className={ui.buttonGhost}
            disabled={talkRoomId === null || recordTalkRoom.isPending}
            onClick={() => {
              if (talkRoomId !== null) recordTalkRoom.mutate(talkRoomId)
            }}
          >
            参加しました
          </button>
          <ErrorNote error={recordTalkRoom.error} />
        </div>
      )}

      {step === 'notifications' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>
            <LuBell aria-hidden="true" size="1.5em" />
          </div>
          <span className={ui.sectionTitle}>通知の設定</span>
          <p className={styles.note}>
            リマインダーやレポート完成の通知を LINE
            で受け取りますか？あとからこの画面で有効化できます。
          </p>
          <button
            className={ui.button}
            disabled={activateNotification.isPending}
            onClick={() => activateNotification.mutate()}
          >
            通知を受け取る
          </button>
          <button className={ui.buttonGhost} onClick={() => setNotificationsDeferred(true)}>
            あとで設定する
          </button>
          <ErrorNote error={activateNotification.error} />
        </div>
      )}

      {step === 'phase2' && user?.kind === 'phase1_completed' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>
            <LuRocket aria-hidden="true" size="1.5em" />
          </div>
          <span className={ui.sectionTitle}>Phase 2 をはじめる</span>
          <p className={styles.note}>
            データ連携と初期設定に進みます。Gmail 連携（A）→
            初期残高の登録（B）の順で完了し、過去明細の取込（F）は任意です。
          </p>
          <button
            className={ui.button}
            disabled={startPhase2.isPending}
            onClick={() => startPhase2.mutate()}
          >
            Phase 2 を開始する
          </button>
          <ErrorNote error={startPhase2.error} />
        </div>
      )}

      {step === 'phase2' && progress !== undefined && (
        <div className={ui.card}>
          <span className={ui.sectionTitle}>Phase 2 の進捗</span>
          <p className={styles.note}>A → B の順で完了する必要があります。F はスキップできます。</p>

          <div className={styles.sectionRow}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionBadge}>A</span>
              <span className={styles.sectionName}>Gmail 連携</span>
              {progress.sectionA.kind === 'completed' ? (
                <span className={ui.badgeAccent}>完了</span>
              ) : (
                <span className={ui.badge}>未完了</span>
              )}
            </div>
            {progress.sectionA.kind !== 'completed' && (
              <>
                <p className={styles.note}>
                  利用明細メールの自動取込に使います。認可は外部ブラウザで行い、完了後にこの画面へ戻って「連携状態を更新」を押してください。
                </p>
                <div className={ui.row}>
                  <button
                    className={ui.buttonGhost}
                    disabled={gmailAuthorize.isPending}
                    onClick={() => gmailAuthorize.mutate()}
                  >
                    Gmail 連携をはじめる
                  </button>
                  <button className={ui.buttonGhost} onClick={() => void invalidate()}>
                    連携状態を更新
                  </button>
                </div>
                <ErrorNote error={gmailAuthorize.error} />
              </>
            )}
          </div>

          <div className={styles.sectionRow}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionBadge}>B</span>
              <span className={styles.sectionName}>初期残高の登録</span>
              {progress.sectionB.kind === 'completed' ? (
                <span className={ui.badgeAccent}>完了</span>
              ) : (
                <span className={ui.badge}>未完了</span>
              )}
            </div>
            {progress.sectionB.kind !== 'completed' && (
              <>
                <p className={styles.note}>
                  口座の現在残高を登録して資産管理を始めます。登録済みの口座（SMBC・その他貯蓄・NISA）を初期残高として記録します。
                </p>
                {initialBalanceRef !== null ? (
                  <button
                    className={ui.buttonGhost}
                    disabled={progress.sectionA.kind !== 'completed' || completeSectionB.isPending}
                    onClick={() => completeSectionB.mutate(initialBalanceRef)}
                  >
                    {progress.sectionA.kind === 'completed'
                      ? '登録済みの口座で確定する'
                      : 'A の完了後に登録できます'}
                  </button>
                ) : (
                  <p className={styles.note}>
                    口座（SMBC・その他貯蓄・NISA）が未登録です。
                    <Link href="/balances">残高ページ</Link>で登録状況を確認してください。
                  </p>
                )}
                <ErrorNote error={completeSectionB.error} />
              </>
            )}
          </div>

          <div className={styles.sectionRow}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionBadge}>F</span>
              <span className={styles.sectionName}>過去明細の取込</span>
              {progress.sectionF.kind === 'completed' && (
                <span className={ui.badgeAccent}>完了</span>
              )}
              {progress.sectionF.kind === 'skipped' && <span className={ui.badge}>スキップ</span>}
              {progress.sectionF.kind === 'not_started' && <span className={ui.badge}>未完了</span>}
            </div>
            {progress.sectionF.kind === 'not_started' && (
              <>
                <p className={styles.note}>
                  過去のカード・銀行明細を取り込んで、これまでの家計も見えるようにします（任意）。
                </p>
                <div className={ui.row}>
                  <Link href="/imports" className={ui.buttonGhost}>
                    取込画面を開く
                  </Link>
                  {importCompletion !== null && (
                    <button
                      className={ui.buttonGhost}
                      disabled={finishSectionF.isPending}
                      onClick={() =>
                        finishSectionF.mutate({
                          kind: 'completed',
                          importJobId: importCompletion.importJobId,
                        })
                      }
                    >
                      完了にする
                    </button>
                  )}
                  <button
                    className={styles.backLink}
                    disabled={finishSectionF.isPending}
                    onClick={() => finishSectionF.mutate({ kind: 'skipped' })}
                  >
                    スキップ
                  </button>
                </div>
                <ErrorNote error={finishSectionF.error} />
              </>
            )}
          </div>

          {progress.sectionA.kind === 'completed' && progress.sectionB.kind === 'completed' && (
            <div className={styles.sectionRow}>
              <button
                className={ui.button}
                disabled={completePhase2.isPending}
                onClick={() => completePhase2.mutate()}
              >
                Phase 2 を完了する
              </button>
              <ErrorNote error={completePhase2.error} />
            </div>
          )}
        </div>
      )}

      {step === 'spouse_wait' && (
        <div className={ui.card}>
          {spouse?.kind === 'both_completed' ? (
            <>
              <div className={styles.stepAvatar}>
                <LuPartyPopper aria-hidden="true" size="1.5em" />
              </div>
              <span className={ui.sectionTitle}>ふたりの設定が完了しました！</span>
              <p className={styles.note}>
                {nickname !== '' ? `${nickname}さん、` : ''}
                おつかれさまでした。ダッシュボードから家計管理を始めましょう。
              </p>
              <Link href="/" className={ui.button} style={{ textAlign: 'center' }}>
                ダッシュボードへ
              </Link>
            </>
          ) : (
            <>
              <div className={styles.stepAvatar}>
                <LuHourglass aria-hidden="true" size="1.5em" />
              </div>
              <span className={ui.sectionTitle}>配偶者の設定完了を待っています</span>
              <p className={styles.note}>
                あなたの設定は完了しています。ふたりとも Phase 2
                まで完了すると運用が始まります。画面を開き直すと最新の状態を確認します。
              </p>
              <button
                className={ui.buttonGhost}
                disabled={spouseQuery.isFetching}
                onClick={() => void spouseQuery.refetch()}
              >
                最新の状態を確認
              </button>
              <ErrorNote error={spouseQuery.error} />
            </>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className={ui.card}>
          <div className={styles.stepAvatar}>
            <LuPartyPopper aria-hidden="true" size="1.5em" />
          </div>
          <span className={ui.sectionTitle}>運用開始済みです</span>
          <p className={styles.note}>
            {nickname !== '' ? `${nickname}さん、` : ''}
            設定はすべて完了しています。ダッシュボードから家計管理を続けましょう。
          </p>
          <Link href="/" className={ui.button} style={{ textAlign: 'center' }}>
            ダッシュボードへ
          </Link>
        </div>
      )}
    </main>
  )
}
