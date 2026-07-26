'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CategoryIdSchema, YearMonthSchema, type YearMonth } from '@warimaru/domain'
import { MonthNavigator } from '@/components/dashboard/MonthNavigator'
import { Modal } from '@/components/ui/Modal'
import { apiFetch, apiMutate } from '@/lib/api-client'
import {
  CategoryListWireSchema,
  ExpenseTypeListWireSchema,
  TransactionListWireSchema,
  UnclassifiedSummaryWireSchema,
  UnknownResponseSchema,
  type ExpenseClassWire,
  type TransactionListItemWire,
} from '@/lib/api-schemas'
import { EXPENSE_CLASS_LABELS, expenseClassLabel } from '@/lib/labels'
import { formatMoney } from '@/lib/format'
import { formatDate, formatMonthLabel, getCurrentMonth } from '@/lib/month'
import { LuPlus, LuTriangleAlert } from '@/components/ui/icons'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

type ClassFilter = ExpenseClassWire | 'all'

interface ClassificationInput {
  categoryId: string
  expenseClass: ExpenseClassWire
  expenseTypeId?: string
}

function useMasters() {
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/categories', CategoryListWireSchema),
    staleTime: 60_000,
  })
  const expenseTypes = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => apiFetch('/api/expense-types', ExpenseTypeListWireSchema),
    staleTime: 60_000,
  })
  return { categories: categories.data?.items ?? [], expenseTypes: expenseTypes.data?.items ?? [] }
}

interface ClassificationFieldsProps {
  value: ClassificationInput
  onChange: (value: ClassificationInput) => void
  categories: { categoryId: string; name: string }[]
  expenseTypes: { expenseTypeId: string; name: string }[]
}

function ClassificationFields({
  value,
  onChange,
  categories,
  expenseTypes,
}: ClassificationFieldsProps) {
  return (
    <>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>カテゴリ</label>
        <select
          className={ui.select}
          value={value.categoryId}
          onChange={e => onChange({ ...value, categoryId: e.target.value })}
        >
          <option value="">選択してください</option>
          {categories.map(category => (
            <option key={category.categoryId} value={category.categoryId}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>費用区分</label>
        <select
          className={ui.select}
          value={value.expenseClass}
          onChange={e => onChange({ ...value, expenseClass: e.target.value as ExpenseClassWire })}
        >
          {Object.entries(EXPENSE_CLASS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {value.expenseClass === 'business_expense' && (
        <div className={ui.field}>
          <label className={ui.fieldLabel}>経費種別</label>
          <select
            className={ui.select}
            value={value.expenseTypeId ?? ''}
            onChange={e =>
              onChange({
                ...value,
                expenseTypeId: e.target.value === '' ? undefined : e.target.value,
              })
            }
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
    </>
  )
}

function toDateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 発生日の初期値。表示中の月が当月なら今日、それ以外の月なら 1 日 */
function defaultOccurredAt(month: YearMonth): string {
  return month === getCurrentMonth() ? toDateInputValue(new Date()) : `${month}-01`
}

function classificationBody(input: ClassificationInput): Record<string, unknown> {
  return {
    categoryId: input.categoryId,
    expenseClass: input.expenseClass,
    ...(input.expenseClass === 'business_expense' && input.expenseTypeId !== undefined
      ? { expenseTypeId: input.expenseTypeId }
      : {}),
  }
}

function classificationValid(input: ClassificationInput): boolean {
  if (input.categoryId === '') return false
  if (input.expenseClass === 'business_expense' && (input.expenseTypeId ?? '') === '') return false
  return true
}

interface CreateModalProps {
  month: YearMonth
  onClose: () => void
}

function CreateModal({ month, onClose }: CreateModalProps) {
  const queryClient = useQueryClient()
  const { categories, expenseTypes } = useMasters()
  const [merchantName, setMerchantName] = useState('')
  const [amount, setAmount] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => defaultOccurredAt(month))
  const [withClassification, setWithClassification] = useState(false)
  const [classification, setClassification] = useState<ClassificationInput>({
    categoryId: '',
    expenseClass: 'household',
  })

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/transactions',
        {
          method: 'POST',
          body: {
            merchantName,
            amount: Number(amount),
            occurredAt,
            ...(withClassification ? { classification: classificationBody(classification) } : {}),
          },
        },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
      onClose()
    },
  })

  const valid =
    merchantName.trim() !== '' &&
    amount !== '' &&
    Number(amount) !== 0 &&
    Number.isInteger(Number(amount)) &&
    occurredAt !== '' &&
    (!withClassification || classificationValid(classification))

  return (
    <Modal title="取引を追加" onClose={onClose}>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>店舗・摘要</label>
        <input
          className={ui.input}
          value={merchantName}
          onChange={e => setMerchantName(e.target.value)}
          placeholder="例: スーパーマルエツ"
        />
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>金額（円）</label>
        <input
          className={ui.input}
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="例: 1280"
        />
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>発生日</label>
        <input
          className={ui.input}
          type="date"
          value={occurredAt}
          onChange={e => setOccurredAt(e.target.value)}
        />
      </div>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={withClassification}
          onChange={e => setWithClassification(e.target.checked)}
        />
        <span>分類も同時に登録する</span>
      </label>
      {withClassification && (
        <ClassificationFields
          value={classification}
          onChange={setClassification}
          categories={categories}
          expenseTypes={expenseTypes}
        />
      )}
      {mutation.error && <div className={ui.error}>{mutation.error.message}</div>}
      <button
        className={ui.button}
        disabled={!valid || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '登録中...' : `${formatMonthLabel(month)}に登録`}
      </button>
    </Modal>
  )
}

interface DetailModalProps {
  transaction: TransactionListItemWire
  onClose: () => void
}

function DetailModal({ transaction, onClose }: DetailModalProps) {
  const queryClient = useQueryClient()
  const { categories, expenseTypes } = useMasters()
  const [merchantName, setMerchantName] = useState(transaction.merchantName ?? '')
  const [amount, setAmount] = useState(
    transaction.amount !== null ? String(transaction.amount) : '',
  )
  const [occurredAt, setOccurredAt] = useState(() => toDateInputValue(transaction.occurredAt))
  const [classification, setClassification] = useState<ClassificationInput>({
    categoryId: transaction.categoryId ?? '',
    expenseClass: transaction.expenseClass,
  })

  const invalidateAndClose = async () => {
    await queryClient.invalidateQueries({ queryKey: ['transactions'] })
    onClose()
  }

  const update = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/transactions/${transaction.transactionId}`,
        {
          method: 'PUT',
          body: { merchantName, amount: Number(amount), occurredAt },
        },
        UnknownResponseSchema,
      ),
    onSuccess: invalidateAndClose,
  })

  const classify = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/transactions/${transaction.transactionId}/classify`,
        { method: 'PUT', body: classificationBody(classification) },
        UnknownResponseSchema,
      ),
    onSuccess: invalidateAndClose,
  })

  const remove = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/transactions/${transaction.transactionId}`,
        { method: 'DELETE' },
        UnknownResponseSchema,
      ),
    onSuccess: invalidateAndClose,
  })

  // プライバシー適用で merchantName / amount が null の行（配偶者の個人取引）は編集不可
  const editable = transaction.merchantName !== null && transaction.amount !== null
  const updateValid =
    merchantName.trim() !== '' &&
    amount !== '' &&
    Number(amount) !== 0 &&
    Number.isInteger(Number(amount)) &&
    occurredAt !== ''
  const error = update.error ?? classify.error ?? remove.error

  return (
    <Modal title={transaction.isUnclassified ? '未分類取引' : '取引の編集'} onClose={onClose}>
      {!editable && (
        <div className={ui.empty}>配偶者の個人取引のため、詳細の閲覧・編集はできません</div>
      )}
      {editable && (
        <>
          <div className={ui.field}>
            <label className={ui.fieldLabel}>店舗・摘要</label>
            <input
              className={ui.input}
              value={merchantName}
              onChange={e => setMerchantName(e.target.value)}
            />
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel}>金額（円）</label>
            <input
              className={ui.input}
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel}>発生日</label>
            <input
              className={ui.input}
              type="date"
              value={occurredAt}
              onChange={e => setOccurredAt(e.target.value)}
            />
          </div>
          <button
            className={ui.buttonGhost}
            disabled={!updateValid || update.isPending}
            onClick={() => update.mutate()}
          >
            {update.isPending ? '保存中...' : '基本情報を保存'}
          </button>

          <div className={ui.sectionTitle}>
            {transaction.isUnclassified ? '分類する' : '再分類する'}
          </div>
          <ClassificationFields
            value={classification}
            onChange={setClassification}
            categories={categories}
            expenseTypes={expenseTypes}
          />
          <button
            className={ui.button}
            disabled={!classificationValid(classification) || classify.isPending}
            onClick={() => classify.mutate()}
          >
            {classify.isPending ? '分類中...' : '分類を確定'}
          </button>

          <button
            className={ui.buttonDanger}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm('この取引を削除しますか？')) {
                remove.mutate()
              }
            }}
          >
            {remove.isPending ? '削除中...' : 'この取引を削除'}
          </button>
        </>
      )}
      {error && <div className={ui.error}>{error.message}</div>}
    </Modal>
  )
}

/** Deep Link の month パラメータ。YYYY-MM として不正なら当月にフォールバック */
function parseMonthParam(value: string | null): YearMonth {
  const parsed = YearMonthSchema.safeParse(value)
  return parsed.success ? parsed.data : getCurrentMonth()
}

/** Deep Link の categoryId パラメータ。ULID として不正なら「すべてのカテゴリ」にフォールバック */
function parseCategoryParam(value: string | null): string {
  const parsed = CategoryIdSchema.safeParse(value)
  return parsed.success ? parsed.data : ''
}

function TransactionsPageContent() {
  // ダッシュボードのドリルダウン（spec §5.5 ⑧）から
  // /transactions?month=YYYY-MM&categoryId=... で遷移してくる
  const searchParams = useSearchParams()
  const [month, setMonth] = useState<YearMonth>(() => parseMonthParam(searchParams.get('month')))
  const [classFilter, setClassFilter] = useState<ClassFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>(() =>
    parseCategoryParam(searchParams.get('categoryId')),
  )
  const [unclassifiedOnly, setUnclassifiedOnly] = useState(false)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<TransactionListItemWire | null>(null)
  const { categories } = useMasters()

  const listQuery = useQuery({
    queryKey: ['transactions', month, classFilter, categoryFilter, unclassifiedOnly],
    queryFn: () => {
      const params = new URLSearchParams({ month })
      if (classFilter !== 'all') params.set('expenseClass', classFilter)
      if (categoryFilter !== '') params.set('categoryId', categoryFilter)
      if (unclassifiedOnly) params.set('isUnclassifiedOnly', 'true')
      return apiFetch(`/api/transactions?${params.toString()}`, TransactionListWireSchema)
    },
  })

  const summaryQuery = useQuery({
    queryKey: ['transactions', 'unclassified-summary', month],
    queryFn: () =>
      apiFetch(
        `/api/transactions/unclassified-summary?month=${month}`,
        UnclassifiedSummaryWireSchema,
      ),
  })

  const items = listQuery.data ?? []
  const total = items.reduce((sum, item) => sum + (item.amount ?? 0), 0)

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>取引一覧</h1>
      <MonthNavigator month={month} onMonthChange={setMonth} />

      {summaryQuery.data && summaryQuery.data.count > 0 && (
        <button className={styles.unclassifiedBanner} onClick={() => setUnclassifiedOnly(true)}>
          <LuTriangleAlert aria-hidden="true" className={styles.unclassifiedIcon} />
          未分類の取引が {summaryQuery.data.count} 件あります
        </button>
      )}

      <div className={styles.filters}>
        <select
          className={ui.select}
          value={classFilter}
          onChange={e => setClassFilter(e.target.value as ClassFilter)}
        >
          <option value="all">すべての費用区分</option>
          {Object.entries(EXPENSE_CLASS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={ui.select}
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
        >
          <option value="">すべてのカテゴリ</option>
          {categories.map(category => (
            <option key={category.categoryId} value={category.categoryId}>
              {category.name}
            </option>
          ))}
          {/* Deep Link のカテゴリがマスタ未取得・不明でも選択状態を可視化する */}
          {categoryFilter !== '' &&
            !categories.some(category => category.categoryId === categoryFilter) && (
              <option value={categoryFilter}>指定カテゴリ</option>
            )}
        </select>
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={unclassifiedOnly}
            onChange={e => setUnclassifiedOnly(e.target.checked)}
          />
          <span>未分類のみ</span>
        </label>
      </div>

      {listQuery.isLoading && <div className={ui.loading}>読み込み中...</div>}
      {listQuery.error && <div className={ui.error}>取引一覧の取得に失敗しました</div>}

      {!listQuery.isLoading && !listQuery.error && (
        <>
          <div className={styles.totalRow}>
            <span>{items.length} 件</span>
            <span className={styles.totalAmount}>{formatMoney(total)}</span>
          </div>
          {items.length === 0 ? (
            <div className={ui.empty}>この条件の取引はありません</div>
          ) : (
            <ul className={styles.list}>
              {items.map(item => (
                <li key={item.transactionId}>
                  <button className={styles.item} onClick={() => setSelected(item)}>
                    <div className={styles.itemLeft}>
                      <span className={styles.itemDate}>{formatDate(item.occurredAt)}</span>
                      <span className={styles.itemMerchant}>
                        {item.merchantName ?? '（非公開）'}
                      </span>
                      <span className={styles.itemMeta}>
                        {item.isUnclassified ? (
                          <span className={styles.unclassifiedTag}>未分類</span>
                        ) : (
                          <span className={ui.badge}>{item.categoryName ?? 'カテゴリなし'}</span>
                        )}
                        <span className={ui.badge}>{expenseClassLabel(item.expenseClass)}</span>
                      </span>
                    </div>
                    <span className={styles.itemAmount}>
                      {item.amount !== null ? formatMoney(item.amount) : '---'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <button className={styles.fab} onClick={() => setCreating(true)} aria-label="取引を追加">
        <LuPlus aria-hidden="true" />
      </button>

      {creating && <CreateModal month={month} onClose={() => setCreating(false)} />}
      {selected && <DetailModal transaction={selected} onClose={() => setSelected(null)} />}
    </main>
  )
}

export default function TransactionsPage() {
  // Static Export では useSearchParams を使うコンポーネントに Suspense 境界が必須
  return (
    <Suspense fallback={<div className={ui.loading}>読み込み中...</div>}>
      <TransactionsPageContent />
    </Suspense>
  )
}
