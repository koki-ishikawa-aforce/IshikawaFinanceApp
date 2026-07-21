'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { apiFetch, apiMutate } from '@/lib/api-client'
import {
  CategoryListWireSchema,
  ExpenseTypeListWireSchema,
  MonthlyLimitListWireSchema,
  UnknownResponseSchema,
  type CategoryWire,
  type ExpenseClassWire,
  type ExpenseTypeWire,
  type MonthlyLimitWire,
} from '@/lib/api-schemas'
import { EXPENSE_CLASS_LABELS } from '@/lib/labels'
import { formatMoney } from '@/lib/format'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

type Tab = 'categories' | 'expense-types' | 'limits'

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

  const valid = destinationCategoryId !== '' && (!needsExpenseType || destinationExpenseTypeId !== '')

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
      apiMutate('/api/categories', { method: 'POST', body: { name: newName.trim() } }, UnknownResponseSchema),
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

  const valid = unlimited || (amount !== '' && Number.isInteger(Number(amount)) && Number(amount) >= 0)

  return (
    <Modal title={`「${expenseType.name}」の月次上限`} onClose={onClose}>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={unlimited}
          onChange={e => setUnlimited(e.target.checked)}
        />
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
  { id: 'categories', label: 'カテゴリ' },
  { id: 'expense-types', label: '経費種別' },
  { id: 'limits', label: '月次上限' },
]

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('categories')

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>マスタ管理</h1>

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

      {tab === 'categories' && <CategoriesTab />}
      {tab === 'expense-types' && <ExpenseTypesTab />}
      {tab === 'limits' && <LimitsTab />}

      <Link href="/onboarding" className={styles.onboardingLink}>
        🚀 はじめての設定（オンボーディング）を開く
      </Link>
    </main>
  )
}
