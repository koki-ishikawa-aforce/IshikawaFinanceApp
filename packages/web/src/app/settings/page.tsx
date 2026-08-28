'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { AccountsTab } from '@/components/settings/AccountsTab'
import { LearningRulesTab } from '@/components/settings/LearningRulesTab'
import { apiFetch, apiMutate, describeRequestFailure } from '@/lib/api-client'
import {
  CategoryListWireSchema,
  ExpenseTypeListWireSchema,
  GmailAuthorizeResponseSchema,
  GmailLinkWireSchema,
  MonthlyLimitListWireSchema,
  SettingsProfileWireSchema,
  UnknownResponseSchema,
  type CategoryWire,
  type ExpenseClassWire,
  type ExpenseTypeWire,
  type MonthlyLimitWire,
} from '@/lib/api-schemas'
import { EXPENSE_CLASS_LABELS } from '@/lib/labels'
import { formatMoney } from '@/lib/format'
import { formatDateWithYear } from '@/lib/month'
import { openExternal } from '@/lib/liff'
import { RoleIcon } from '@/components/ui/RoleIcon'
import { LuRocket, LuReceipt, LuDownload } from '@/components/ui/icons'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import listStyles from '@/components/settings/settingsList.module.css'
import styles from './page.module.css'

type Tab =
  | 'profile'
  | 'accounts'
  | 'categories'
  | 'expense-types'
  | 'limits'
  | 'classification'
  | 'oauth'

// ---------- プロフィール（#48） ----------

function ProfileForm({
  role,
  initialNickname,
}: {
  role: 'honey' | 'darling'
  initialNickname: string | null
}) {
  const queryClient = useQueryClient()
  const [nickname, setNickname] = useState(initialNickname ?? '')

  const save = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/settings/nickname',
        { method: 'PUT', body: { nickname: nickname.trim() === '' ? null : nickname.trim() } },
        SettingsProfileWireSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings-profile'] })
    },
  })

  return (
    <>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>役割（変更不可）</label>
        <span className={styles.roleValue}>
          <RoleIcon role={role} className={ui.iconSm} /> {role === 'honey' ? 'Honey' : 'Darling'}
        </span>
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>ニックネーム（10 文字まで）</label>
        <input
          className={ui.input}
          value={nickname}
          maxLength={10}
          onChange={e => setNickname(e.target.value)}
          placeholder="未設定（ロール名で表示）"
        />
      </div>
      <p className={ui.note}>空欄で保存するとニックネームを解除し、ロール名の表示に戻ります。</p>
      {save.error && <ErrorState>{save.error.message}</ErrorState>}
      {/* 失敗は ErrorState が読み上げる。成功も同じように伝える(usability 8-4) */}
      {save.isSuccess && (
        <p className={ui.note} role="status">
          保存しました
        </p>
      )}
      <button className={ui.button} disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? '保存中...' : '保存'}
      </button>
    </>
  )
}

function ProfileTab() {
  const profileQuery = useQuery({
    queryKey: ['settings-profile'],
    queryFn: () => apiFetch('/api/settings/profile', SettingsProfileWireSchema),
  })

  const profile = profileQuery.data?.profile

  return (
    <div className={ui.card}>
      <span className={ui.sectionTitle}>プロフィール</span>
      {profileQuery.isLoading && <LoadingState />}
      {profileQuery.error && (
        <ErrorState>
          {describeRequestFailure(profileQuery.error, 'プロフィールの取得に失敗しました')}
        </ErrorState>
      )}
      {profile && (
        <ProfileForm
          key={`${profile.userId}:${profile.nickname ?? ''}`}
          role={profile.role}
          initialNickname={profile.nickname}
        />
      )}
    </div>
  )
}

// ---------- カテゴリ ----------

function CategoryDeleteModal({
  target,
  categories,
  expenseTypes,
  onClose,
}: {
  target: CategoryWire
  categories: CategoryWire[]
  expenseTypes: ExpenseTypeWire[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [destinationCategoryId, setDestinationCategoryId] = useState('')
  const [destinationExpenseClass, setDestinationExpenseClass] =
    useState<ExpenseClassWire>('household')
  const [destinationExpenseTypeId, setDestinationExpenseTypeId] = useState('')

  const destinations = categories.filter(c => c.categoryId !== target.categoryId)
  const needsExpenseType = destinationExpenseClass === 'business_expense'

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/categories/${target.categoryId}/deletion-requests`,
        {
          method: 'POST',
          body: {
            destinationCategoryId,
            destinationExpenseClass,
            ...(needsExpenseType ? { destinationExpenseTypeId } : {}),
          },
        },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['categories'] })
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
      onClose()
    },
  })

  const valid =
    destinationCategoryId !== '' && (!needsExpenseType || destinationExpenseTypeId !== '')

  return (
    <Modal title={`「${target.name}」を削除`} onClose={onClose}>
      <p className={ui.warning}>
        削除すると、このカテゴリに分類済みの取引と学習ルールは、指定した移動先へ付け替えられます。この操作は取り消せません。
      </p>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>移動先カテゴリ</label>
        <select
          className={ui.select}
          value={destinationCategoryId}
          onChange={e => setDestinationCategoryId(e.target.value)}
        >
          <option value="">選択してください</option>
          {destinations.map(category => (
            <option key={category.categoryId} value={category.categoryId}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>移動先の費用区分</label>
        <select
          className={ui.select}
          value={destinationExpenseClass}
          onChange={e => setDestinationExpenseClass(e.target.value as ExpenseClassWire)}
        >
          {Object.entries(EXPENSE_CLASS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {needsExpenseType && (
        <div className={ui.field}>
          <label className={ui.fieldLabel}>移動先の経費種別</label>
          <select
            className={ui.select}
            value={destinationExpenseTypeId}
            onChange={e => setDestinationExpenseTypeId(e.target.value)}
          >
            <option value="">選択してください</option>
            {expenseTypes.map(expenseType => (
              <option key={expenseType.expenseTypeId} value={expenseType.expenseTypeId}>
                {expenseType.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {mutation.error && <ErrorState>{mutation.error.message}</ErrorState>}
      <button
        className={ui.buttonDanger}
        disabled={!valid || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '削除中...' : '削除を実行'}
      </button>
    </Modal>
  )
}

function CategoriesTab() {
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<CategoryWire | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<CategoryWire | null>(null)

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/categories', CategoryListWireSchema),
  })
  const expenseTypesQuery = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => apiFetch('/api/expense-types', ExpenseTypeListWireSchema),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['categories'] })

  const create = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/categories',
        { method: 'POST', body: { name: newName.trim() } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      setNewName('')
      await invalidate()
    },
  })

  const rename = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/categories/${renaming?.categoryId}`,
        { method: 'PUT', body: { name: renameValue.trim() } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      setRenaming(null)
      await invalidate()
    },
  })

  const items = categoriesQuery.data?.items ?? []

  return (
    <div className={ui.card}>
      <span className={ui.sectionTitle}>カテゴリ</span>
      {categoriesQuery.isLoading && <LoadingState />}
      {categoriesQuery.error && (
        <ErrorState>
          {describeRequestFailure(categoriesQuery.error, 'カテゴリの取得に失敗しました')}
        </ErrorState>
      )}
      <ul className={listStyles.list}>
        {items.map(category => (
          <li key={category.categoryId} className={listStyles.row}>
            <span className={listStyles.name}>{category.name}</span>
            {category.kind === 'default' ? (
              <span className={ui.badge}>規定</span>
            ) : (
              <span className={listStyles.rowActions}>
                <button
                  className={ui.textButton}
                  aria-label={`${category.name}を改名`}
                  onClick={() => {
                    setRenaming(category)
                    setRenameValue(category.name)
                  }}
                >
                  改名
                </button>
                <button
                  className={`${ui.textButton} ${ui.textButtonDanger}`}
                  aria-label={`${category.name}を削除`}
                  onClick={() => setDeleting(category)}
                >
                  削除
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.addRow}>
        <input
          className={ui.input}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="新しいカテゴリ名"
        />
        <button
          className={ui.button}
          disabled={newName.trim() === '' || create.isPending}
          onClick={() => create.mutate()}
        >
          追加
        </button>
      </div>
      {create.error && <ErrorState>{create.error.message}</ErrorState>}

      {renaming !== null && (
        <Modal title="カテゴリを改名" onClose={() => setRenaming(null)}>
          <input
            className={ui.input}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
          />
          {rename.error && <ErrorState>{rename.error.message}</ErrorState>}
          <button
            className={ui.button}
            disabled={renameValue.trim() === '' || rename.isPending}
            onClick={() => rename.mutate()}
          >
            {rename.isPending ? '保存中...' : '保存'}
          </button>
        </Modal>
      )}
      {deleting !== null && (
        <CategoryDeleteModal
          target={deleting}
          categories={items}
          expenseTypes={expenseTypesQuery.data?.items ?? []}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

// ---------- 経費種別（費用区分マスタ） ----------

function ExpenseTypeDeleteModal({
  target,
  expenseTypes,
  onClose,
}: {
  target: ExpenseTypeWire
  expenseTypes: ExpenseTypeWire[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [destinationExpenseTypeId, setDestinationExpenseTypeId] = useState('')
  const destinations = expenseTypes.filter(t => t.expenseTypeId !== target.expenseTypeId)

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/expense-types/${target.expenseTypeId}/deletion-requests`,
        { method: 'POST', body: { destinationExpenseTypeId } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['expense-types'] })
      await queryClient.invalidateQueries({ queryKey: ['monthly-limits'] })
      onClose()
    },
  })

  return (
    <Modal title={`「${target.name}」を削除`} onClose={onClose}>
      <p className={ui.warning}>
        削除すると、この経費種別に紐づく取引・学習ルール・月次上限は、指定した移動先へ付け替えられます。この操作は取り消せません。
      </p>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>移動先の経費種別</label>
        <select
          className={ui.select}
          value={destinationExpenseTypeId}
          onChange={e => setDestinationExpenseTypeId(e.target.value)}
        >
          <option value="">選択してください</option>
          {destinations.map(expenseType => (
            <option key={expenseType.expenseTypeId} value={expenseType.expenseTypeId}>
              {expenseType.name}
            </option>
          ))}
        </select>
      </div>
      {mutation.error && <ErrorState>{mutation.error.message}</ErrorState>}
      <button
        className={ui.buttonDanger}
        disabled={destinationExpenseTypeId === '' || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '削除中...' : '削除を実行'}
      </button>
    </Modal>
  )
}

function ExpenseTypesTab() {
  const queryClient = useQueryClient()
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<ExpenseTypeWire | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<ExpenseTypeWire | null>(null)

  const expenseTypesQuery = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => apiFetch('/api/expense-types', ExpenseTypeListWireSchema),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['expense-types'] })

  const create = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/expense-types',
        { method: 'POST', body: { name: newName.trim() } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      setNewName('')
      await invalidate()
    },
  })

  const rename = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/expense-types/${renaming?.expenseTypeId}`,
        { method: 'PUT', body: { name: renameValue.trim() } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      setRenaming(null)
      await invalidate()
    },
  })

  const items = expenseTypesQuery.data?.items ?? []

  return (
    <div className={ui.card}>
      <span className={ui.sectionTitle}>経費種別</span>
      {expenseTypesQuery.isLoading && <LoadingState />}
      {expenseTypesQuery.error && (
        <ErrorState>
          {describeRequestFailure(expenseTypesQuery.error, '経費種別の取得に失敗しました')}
        </ErrorState>
      )}
      <ul className={listStyles.list}>
        {items.map(expenseType => (
          <li key={expenseType.expenseTypeId} className={listStyles.row}>
            <span className={listStyles.name}>{expenseType.name}</span>
            {expenseType.kind === 'default' ? (
              <span className={ui.badge}>規定</span>
            ) : (
              <span className={listStyles.rowActions}>
                <button
                  className={ui.textButton}
                  aria-label={`${expenseType.name}を改名`}
                  onClick={() => {
                    setRenaming(expenseType)
                    setRenameValue(expenseType.name)
                  }}
                >
                  改名
                </button>
                <button
                  className={`${ui.textButton} ${ui.textButtonDanger}`}
                  aria-label={`${expenseType.name}を削除`}
                  onClick={() => setDeleting(expenseType)}
                >
                  削除
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.addRow}>
        <input
          className={ui.input}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="新しい経費種別名"
        />
        <button
          className={ui.button}
          disabled={newName.trim() === '' || create.isPending}
          onClick={() => create.mutate()}
        >
          追加
        </button>
      </div>
      {create.error && <ErrorState>{create.error.message}</ErrorState>}

      {renaming !== null && (
        <Modal title="経費種別を改名" onClose={() => setRenaming(null)}>
          <input
            className={ui.input}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
          />
          {rename.error && <ErrorState>{rename.error.message}</ErrorState>}
          <button
            className={ui.button}
            disabled={renameValue.trim() === '' || rename.isPending}
            onClick={() => rename.mutate()}
          >
            {rename.isPending ? '保存中...' : '保存'}
          </button>
        </Modal>
      )}
      {deleting !== null && (
        <ExpenseTypeDeleteModal
          target={deleting}
          expenseTypes={items}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

// ---------- 月次上限 ----------

function LimitEditModal({
  expenseType,
  limit,
  onClose,
}: {
  expenseType: ExpenseTypeWire
  limit: MonthlyLimitWire | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [unlimited, setUnlimited] = useState(limit?.kind === 'unlimited')
  const [amount, setAmount] = useState(limit?.kind === 'capped' ? String(limit.capAmount) : '')

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/monthly-limits',
        {
          method: 'PUT',
          body: {
            expenseTypeId: expenseType.expenseTypeId,
            capAmount: unlimited ? null : Number(amount),
          },
        },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['monthly-limits'] })
      onClose()
    },
  })

  const valid =
    unlimited || (amount !== '' && Number.isInteger(Number(amount)) && Number(amount) >= 0)

  return (
    <Modal title={`「${expenseType.name}」の月次上限`} onClose={onClose}>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={unlimited} onChange={e => setUnlimited(e.target.checked)} />
        <span>上限なし（無制限）</span>
      </label>
      {!unlimited && (
        <div className={ui.field}>
          <label className={ui.fieldLabel}>上限金額（円 / 月）</label>
          <input
            className={ui.input}
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="例: 10000"
          />
        </div>
      )}
      {mutation.error && <ErrorState>{mutation.error.message}</ErrorState>}
      <button
        className={ui.button}
        disabled={!valid || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '保存中...' : '保存'}
      </button>
    </Modal>
  )
}

function LimitsTab() {
  const [editing, setEditing] = useState<ExpenseTypeWire | null>(null)

  const expenseTypesQuery = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => apiFetch('/api/expense-types', ExpenseTypeListWireSchema),
  })
  const limitsQuery = useQuery({
    queryKey: ['monthly-limits'],
    queryFn: () => apiFetch('/api/monthly-limits', MonthlyLimitListWireSchema),
  })

  const limitsByType = new Map(
    (limitsQuery.data?.items ?? []).map(limit => [limit.expenseTypeId, limit]),
  )
  const expenseTypes = expenseTypesQuery.data?.items ?? []

  return (
    <div className={ui.card}>
      <span className={ui.sectionTitle}>月次上限</span>
      <p className={ui.note}>
        経費種別ごとに月あたりの経費上限を設定します。上限を超えた分は個人負担として按分されます。
      </p>
      {(expenseTypesQuery.isLoading || limitsQuery.isLoading) && <LoadingState />}
      {(expenseTypesQuery.error ?? limitsQuery.error) && (
        <ErrorState>
          {describeRequestFailure(
            expenseTypesQuery.error ?? limitsQuery.error,
            '月次上限の取得に失敗しました',
          )}
        </ErrorState>
      )}
      <ul className={listStyles.list}>
        {expenseTypes.map(expenseType => {
          const limit = limitsByType.get(expenseType.expenseTypeId) ?? null
          return (
            <li key={expenseType.expenseTypeId} className={listStyles.row}>
              <span className={listStyles.name}>{expenseType.name}</span>
              <span className={listStyles.rowActions}>
                <span className={styles.limitValue}>
                  {limit === null
                    ? '未設定'
                    : limit.kind === 'unlimited'
                      ? '上限なし'
                      : formatMoney(limit.capAmount)}
                </span>
                <button
                  className={ui.textButton}
                  aria-label={`${expenseType.name}の月次上限を変更`}
                  onClick={() => setEditing(expenseType)}
                >
                  変更
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      {editing !== null && (
        <LimitEditModal
          expenseType={editing}
          limit={limitsByType.get(editing.expenseTypeId) ?? null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ---------- Gmail 連携（#392） ----------

/**
 * Gmail 連携の状態表示と再認可（OAuth 失効通知の LINE DM が
 * `/settings?section=oauth&provider=gmail` でこのタブへ誘導する — 論点57 ④）。
 *
 * 認可はオンボーディングの Gmail 連携（Section A）と同じ経路（OQ-7: 外部ブラウザで
 * 認可 → この画面に戻って状態を更新）。`provider` パラメータは Gmail しか無い現状では
 * 読まない（Deep Link マップの表記に合わせて送り側が付けている）。
 */
function GmailLinkTab() {
  const queryClient = useQueryClient()
  const gmailLinkQuery = useQuery({
    queryKey: ['settings-gmail-link'],
    queryFn: () => apiFetch('/api/settings/gmail-link', GmailLinkWireSchema),
  })

  const authorize = useMutation({
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

  const link = gmailLinkQuery.data?.gmailLink

  return (
    <div className={ui.card}>
      <h2 className={ui.sectionTitle}>Gmail 連携</h2>
      <p className={ui.note}>
        カード・銀行の利用明細メールを自動で取り込むための連携です。連携が切れると、カード利用が家計簿に反映されなくなります。
      </p>
      {/* 読み込み中 → 状態表示 / エラー に入れ替わる領域（docs/design/usability.md 8-4）。
          再認可から戻って「連携状態を更新」を押したときの「切れています」→「連携中」の
          差し替えも支援技術に通知する。入れ替わる側は announce={false} で入れ子を避ける */}
      <div role="status">
        {gmailLinkQuery.isLoading && <LoadingState announce={false} />}
        {gmailLinkQuery.isError && (
          <ErrorState
            announce={false}
            onRetry={() => void gmailLinkQuery.refetch()}
            isRetrying={gmailLinkQuery.isFetching}
          >
            {describeRequestFailure(gmailLinkQuery.error, 'Gmail 連携の状態を取得できませんでした')}
          </ErrorState>
        )}
        {link && (
          <>
            <div className={ui.row}>
              <span className={ui.fieldLabel}>連携の状態</span>
              {link.kind === 'valid' && <span className={ui.badgeAccent}>連携中</span>}
              {link.kind === 'revocation_detected' && (
                <span className={ui.badgeWarning}>連携が切れています</span>
              )}
              {link.kind === 'not_linked' && <span className={ui.badge}>未連携</span>}
            </div>
            {link.kind === 'valid' && (
              <p className={ui.note}>
                連携した日: {formatDateWithYear(link.authorizedAt)}
                。明細メールは毎日自動で取り込まれます。
              </p>
            )}
            {link.kind === 'revocation_detected' && (
              <p className={ui.warning}>
                {formatDateWithYear(link.revocationDetectedAt)}
                から自動取込が止まっています。連携し直すと再開します。
              </p>
            )}
            {link.kind === 'not_linked' && (
              <p className={ui.note}>
                Gmail が連携されていません。連携すると利用明細メールの自動取込が始まります。
              </p>
            )}
            {link.kind !== 'valid' && (
              <>
                <p className={ui.note}>
                  認可は外部ブラウザで行います。完了後にこの画面へ戻って「連携状態を更新」を押してください。
                </p>
                <div className={ui.row}>
                  <button
                    className={ui.button}
                    disabled={authorize.isPending}
                    onClick={() => authorize.mutate()}
                  >
                    {authorize.isPending
                      ? '連携準備中...'
                      : link.kind === 'revocation_detected'
                        ? 'Gmail を連携し直す'
                        : 'Gmail 連携をはじめる'}
                  </button>
                  <button
                    className={ui.buttonGhost}
                    disabled={gmailLinkQuery.isFetching}
                    onClick={() =>
                      void queryClient.invalidateQueries({ queryKey: ['settings-gmail-link'] })
                    }
                  >
                    {gmailLinkQuery.isFetching ? '更新中...' : '連携状態を更新'}
                  </button>
                </div>
                {authorize.isError && (
                  <ErrorState announce={false}>
                    {describeRequestFailure(
                      authorize.error,
                      'Gmail の連携を開始できませんでした。通信状況を確かめて、もう一度お試しください。',
                    )}
                  </ErrorState>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------- ページ ----------

const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'プロフィール' },
  { id: 'accounts', label: '口座' },
  { id: 'categories', label: 'カテゴリ' },
  { id: 'expense-types', label: '経費種別' },
  { id: 'limits', label: '月次上限' },
  { id: 'classification', label: '学習' },
  { id: 'oauth', label: 'Gmail 連携' },
]

const VALID_TABS = new Set<string>(TABS.map(t => t.id))

function parseSectionParam(value: string | null): Tab {
  return value !== null && VALID_TABS.has(value) ? (value as Tab) : 'profile'
}

function SettingsPageContent() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => parseSectionParam(searchParams.get('section')))

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>設定</h1>

      <div className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={tab === t.id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            // 選択中は塗りの違いだけで伝えており、色に頼らない識別が要る（DESIGN.md §6）
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab />}
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'expense-types' && <ExpenseTypesTab />}
      {tab === 'limits' && <LimitsTab />}
      {tab === 'classification' && <LearningRulesTab />}
      {tab === 'oauth' && <GmailLinkTab />}

      {/*
        精算・取込は #614 で下部ナビから外した2画面への入り口。押しやすさの下限(§4-3)を
        満たす受け皿はオンボーディングへのリンクと同じ共通クラス(entryLink)で確保する
      */}
      <Link href="/expense-settlement" className={styles.entryLink}>
        <LuReceipt aria-hidden="true" className={ui.iconInline} /> 経費精算を開く
      </Link>
      <Link href="/imports" className={styles.entryLink}>
        <LuDownload aria-hidden="true" className={ui.iconInline} /> 取込画面を開く
      </Link>
      <Link href="/onboarding" className={styles.entryLink}>
        <LuRocket aria-hidden="true" className={ui.iconInline} />{' '}
        はじめての設定（オンボーディング）を開く
      </Link>
    </main>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingState announce={false} />}>
      <SettingsPageContent />
    </Suspense>
  )
}
