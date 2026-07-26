'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { apiFetch, apiMutate } from '@/lib/api-client'
import {
  CategoryListWireSchema,
  ExpenseTypeListWireSchema,
  MonthlyLimitListWireSchema,
  OwnAccountListWireSchema,
  SettingsProfileWireSchema,
  UnknownResponseSchema,
  type BrokerageNameWire,
  type CategoryWire,
  type ExpenseClassWire,
  type ExpenseTypeWire,
  type MonthlyLimitWire,
  type OwnAccountWire,
} from '@/lib/api-schemas'
import { ACCOUNT_KIND_LABELS, EXPENSE_CLASS_LABELS, brokerageNameLabel } from '@/lib/labels'
import { formatMoney } from '@/lib/format'
import { RoleIcon } from '@/components/ui/RoleIcon'
import { LuPlus, LuRocket } from '@/components/ui/icons'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

type Tab = 'profile' | 'accounts' | 'categories' | 'expense-types' | 'limits'

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
          <RoleIcon role={role} size="1em" /> {role === 'honey' ? 'Honey' : 'Darling'}
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
      <p className={styles.note}>
        空欄で保存するとニックネームを解除し、ロール名の表示に戻ります。
      </p>
      {save.error && <div className={ui.error}>{save.error.message}</div>}
      {save.isSuccess && <p className={styles.note}>保存しました</p>}
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
      {profileQuery.isLoading && <div className={ui.loading}>読み込み中...</div>}
      {profileQuery.error && <div className={ui.error}>プロフィールの取得に失敗しました</div>}
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

// ---------- 口座管理（#48） ----------

function BrokerageNameFields({
  value,
  onChange,
}: {
  value: BrokerageNameWire
  onChange: (next: BrokerageNameWire) => void
}) {
  return (
    <>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>証券会社</label>
        <select
          className={ui.select}
          value={value.kind}
          onChange={e => {
            const kind = e.target.value as BrokerageNameWire['kind']
            onChange(kind === 'other' ? { kind, customName: '' } : { kind })
          }}
        >
          <option value="sbi">SBI証券</option>
          <option value="rakuten">楽天証券</option>
          <option value="other">その他</option>
        </select>
      </div>
      {value.kind === 'other' && (
        <div className={ui.field}>
          <label className={ui.fieldLabel}>証券会社名</label>
          <input
            className={ui.input}
            value={value.customName}
            maxLength={50}
            onChange={e => onChange({ kind: 'other', customName: e.target.value })}
            placeholder="例: マネックス証券"
          />
        </div>
      )}
    </>
  )
}

function isBrokerageNameValid(value: BrokerageNameWire): boolean {
  return value.kind !== 'other' || value.customName.trim() !== ''
}

function normalizeBrokerageName(value: BrokerageNameWire): BrokerageNameWire {
  return value.kind === 'other' ? { kind: 'other', customName: value.customName.trim() } : value
}

function OtherSavingsAddModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [bankName, setBankName] = useState('')
  const [initialBalance, setInitialBalance] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/accounts',
        {
          method: 'POST',
          body: {
            kind: 'other_savings',
            bankName: bankName.trim(),
            initialBalance: Number(initialBalance),
          },
        },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  const valid =
    bankName.trim() !== '' &&
    initialBalance !== '' &&
    Number.isInteger(Number(initialBalance)) &&
    Number(initialBalance) >= 0

  return (
    <Modal title="別銀行貯蓄口座を追加" onClose={onClose}>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>銀行名</label>
        <input
          className={ui.input}
          value={bankName}
          maxLength={50}
          onChange={e => setBankName(e.target.value)}
          placeholder="例: 楽天銀行"
        />
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>現在の残高（円、初期残高として登録）</label>
        <input
          className={ui.input}
          type="number"
          value={initialBalance}
          onChange={e => setInitialBalance(e.target.value)}
          placeholder="例: 500000"
        />
      </div>
      {mutation.error && <div className={ui.error}>{mutation.error.message}</div>}
      <button
        className={ui.button}
        disabled={!valid || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '登録中...' : '登録'}
      </button>
    </Modal>
  )
}

function NisaAddModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [brokerageName, setBrokerageName] = useState<BrokerageNameWire>({ kind: 'sbi' })
  const [initialAccumulated, setInitialAccumulated] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/accounts',
        {
          method: 'POST',
          body: {
            kind: 'nisa',
            brokerageName: normalizeBrokerageName(brokerageName),
            initialAccumulated: Number(initialAccumulated),
          },
        },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  const valid =
    isBrokerageNameValid(brokerageName) &&
    initialAccumulated !== '' &&
    Number.isInteger(Number(initialAccumulated)) &&
    Number(initialAccumulated) >= 0

  return (
    <Modal title="NISA口座を追加" onClose={onClose}>
      <BrokerageNameFields value={brokerageName} onChange={setBrokerageName} />
      <div className={ui.field}>
        <label className={ui.fieldLabel}>積立累計（円、初期累計として登録）</label>
        <input
          className={ui.input}
          type="number"
          value={initialAccumulated}
          onChange={e => setInitialAccumulated(e.target.value)}
          placeholder="例: 200000"
        />
      </div>
      {mutation.error && <div className={ui.error}>{mutation.error.message}</div>}
      <button
        className={ui.button}
        disabled={!valid || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '登録中...' : '登録'}
      </button>
    </Modal>
  )
}

function BankNameEditModal({
  account,
  onClose,
}: {
  account: Extract<OwnAccountWire, { kind: 'other_savings' }>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [bankName, setBankName] = useState(account.bankName)

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/accounts/${account.common.accountId}/bank-name`,
        { method: 'PUT', body: { bankName: bankName.trim() } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  return (
    <Modal title="銀行名を変更" onClose={onClose}>
      <input
        className={ui.input}
        value={bankName}
        maxLength={50}
        onChange={e => setBankName(e.target.value)}
      />
      {mutation.error && <div className={ui.error}>{mutation.error.message}</div>}
      <button
        className={ui.button}
        disabled={bankName.trim() === '' || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '保存中...' : '保存'}
      </button>
    </Modal>
  )
}

function BrokerageNameEditModal({
  account,
  onClose,
}: {
  account: Extract<OwnAccountWire, { kind: 'nisa' }>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [brokerageName, setBrokerageName] = useState<BrokerageNameWire>(account.brokerageName)

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/accounts/${account.common.accountId}/brokerage-name`,
        { method: 'PUT', body: { brokerageName: normalizeBrokerageName(brokerageName) } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  return (
    <Modal title="証券会社名を変更" onClose={onClose}>
      <BrokerageNameFields value={brokerageName} onChange={setBrokerageName} />
      {mutation.error && <div className={ui.error}>{mutation.error.message}</div>}
      <button
        className={ui.button}
        disabled={!isBrokerageNameValid(brokerageName) || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '保存中...' : '保存'}
      </button>
    </Modal>
  )
}

function AccountRow({ account, onEdit }: { account: OwnAccountWire; onEdit: (() => void) | null }) {
  const detail =
    account.kind === 'smbc_bank'
      ? formatMoney(account.balance.currentBalance)
      : account.kind === 'other_savings'
        ? `${account.bankName} / ${formatMoney(account.balance.currentBalance)}`
        : account.kind === 'nisa'
          ? `${brokerageNameLabel(account.brokerageName)} / ${formatMoney(account.contribution.currentAccumulated)}`
          : null
  return (
    <li className={styles.masterRow}>
      <span className={styles.masterName}>{ACCOUNT_KIND_LABELS[account.kind]}</span>
      <span className={styles.rowActions}>
        {detail !== null && <span className={styles.limitValue}>{detail}</span>}
        {onEdit !== null ? (
          <button className={styles.linkButton} onClick={onEdit}>
            編集
          </button>
        ) : (
          <span className={ui.badge}>固定</span>
        )}
      </span>
    </li>
  )
}

function AccountsTab() {
  const [adding, setAdding] = useState<'other_savings' | 'nisa' | null>(null)
  const [editing, setEditing] = useState<OwnAccountWire | null>(null)

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch('/api/accounts', OwnAccountListWireSchema),
  })

  const items = accountsQuery.data?.items ?? []
  const hasOtherSavings = items.some(a => a.kind === 'other_savings')
  const hasNisa = items.some(a => a.kind === 'nisa')

  return (
    <div className={ui.card}>
      <span className={ui.sectionTitle}>口座管理</span>
      <p className={styles.note}>
        自分が所有する口座の一覧です。別銀行貯蓄口座の銀行名と NISA
        口座の証券会社名を編集できます。三井住友系の口座は自動管理のため固定です。
      </p>
      {accountsQuery.isLoading && <div className={ui.loading}>読み込み中...</div>}
      {accountsQuery.error && <div className={ui.error}>口座の取得に失敗しました</div>}
      {!accountsQuery.isLoading && items.length === 0 && (
        <p className={styles.note}>登録済みの口座はありません。</p>
      )}
      <ul className={styles.masterList}>
        {items.map(account => (
          <AccountRow
            key={account.common.accountId}
            account={account}
            onEdit={
              account.kind === 'other_savings' || account.kind === 'nisa'
                ? () => setEditing(account)
                : null
            }
          />
        ))}
      </ul>
      {(!hasOtherSavings || !hasNisa) && (
        <div className={styles.addRow}>
          {!hasOtherSavings && (
            <button
              className={`${ui.button} ${ui.iconLabel}`}
              aria-label="別銀行貯蓄口座を追加"
              onClick={() => setAdding('other_savings')}
            >
              <LuPlus aria-hidden="true" />
              別銀行貯蓄口座
            </button>
          )}
          {!hasNisa && (
            <button
              className={`${ui.button} ${ui.iconLabel}`}
              aria-label="NISA口座を追加"
              onClick={() => setAdding('nisa')}
            >
              <LuPlus aria-hidden="true" />
              NISA口座
            </button>
          )}
        </div>
      )}

      {adding === 'other_savings' && <OtherSavingsAddModal onClose={() => setAdding(null)} />}
      {adding === 'nisa' && <NisaAddModal onClose={() => setAdding(null)} />}
      {editing?.kind === 'other_savings' && (
        <BankNameEditModal account={editing} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === 'nisa' && (
        <BrokerageNameEditModal account={editing} onClose={() => setEditing(null)} />
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
      <p className={styles.warning}>
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
      {mutation.error && <div className={ui.error}>{mutation.error.message}</div>}
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
      {categoriesQuery.isLoading && <div className={ui.loading}>読み込み中...</div>}
      {categoriesQuery.error && <div className={ui.error}>カテゴリの取得に失敗しました</div>}
      <ul className={styles.masterList}>
        {items.map(category => (
          <li key={category.categoryId} className={styles.masterRow}>
            <span className={styles.masterName}>{category.name}</span>
            {category.kind === 'default' ? (
              <span className={ui.badge}>規定</span>
            ) : (
              <span className={styles.rowActions}>
                <button
                  className={styles.linkButton}
                  onClick={() => {
                    setRenaming(category)
                    setRenameValue(category.name)
                  }}
                >
                  改名
                </button>
                <button
                  className={`${styles.linkButton} ${styles.linkDanger}`}
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
      {create.error && <div className={ui.error}>{create.error.message}</div>}

      {renaming !== null && (
        <Modal title="カテゴリを改名" onClose={() => setRenaming(null)}>
          <input
            className={ui.input}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
          />
          {rename.error && <div className={ui.error}>{rename.error.message}</div>}
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
      <p className={styles.warning}>
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
      {mutation.error && <div className={ui.error}>{mutation.error.message}</div>}
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
      {expenseTypesQuery.isLoading && <div className={ui.loading}>読み込み中...</div>}
      {expenseTypesQuery.error && <div className={ui.error}>経費種別の取得に失敗しました</div>}
      <ul className={styles.masterList}>
        {items.map(expenseType => (
          <li key={expenseType.expenseTypeId} className={styles.masterRow}>
            <span className={styles.masterName}>{expenseType.name}</span>
            {expenseType.kind === 'default' ? (
              <span className={ui.badge}>規定</span>
            ) : (
              <span className={styles.rowActions}>
                <button
                  className={styles.linkButton}
                  onClick={() => {
                    setRenaming(expenseType)
                    setRenameValue(expenseType.name)
                  }}
                >
                  改名
                </button>
                <button
                  className={`${styles.linkButton} ${styles.linkDanger}`}
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
      {create.error && <div className={ui.error}>{create.error.message}</div>}

      {renaming !== null && (
        <Modal title="経費種別を改名" onClose={() => setRenaming(null)}>
          <input
            className={ui.input}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
          />
          {rename.error && <div className={ui.error}>{rename.error.message}</div>}
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
      {mutation.error && <div className={ui.error}>{mutation.error.message}</div>}
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
      <p className={styles.note}>
        経費種別ごとに月あたりの経費上限を設定します。上限を超えた分は個人負担として按分されます。
      </p>
      {(expenseTypesQuery.isLoading || limitsQuery.isLoading) && (
        <div className={ui.loading}>読み込み中...</div>
      )}
      {(expenseTypesQuery.error ?? limitsQuery.error) && (
        <div className={ui.error}>月次上限の取得に失敗しました</div>
      )}
      <ul className={styles.masterList}>
        {expenseTypes.map(expenseType => {
          const limit = limitsByType.get(expenseType.expenseTypeId) ?? null
          return (
            <li key={expenseType.expenseTypeId} className={styles.masterRow}>
              <span className={styles.masterName}>{expenseType.name}</span>
              <span className={styles.rowActions}>
                <span className={styles.limitValue}>
                  {limit === null
                    ? '未設定'
                    : limit.kind === 'unlimited'
                      ? '上限なし'
                      : formatMoney(limit.capAmount)}
                </span>
                <button className={styles.linkButton} onClick={() => setEditing(expenseType)}>
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

// ---------- ページ ----------

const TABS: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'プロフィール' },
  { id: 'accounts', label: '口座' },
  { id: 'categories', label: 'カテゴリ' },
  { id: 'expense-types', label: '経費種別' },
  { id: 'limits', label: '月次上限' },
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

      <Link href="/onboarding" className={styles.onboardingLink}>
        <LuRocket aria-hidden="true" style={{ verticalAlign: 'middle' }} />{' '}
        はじめての設定（オンボーディング）を開く
      </Link>
    </main>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className={ui.loading}>読み込み中...</div>}>
      <SettingsPageContent />
    </Suspense>
  )
}
