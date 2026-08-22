'use client'

import { Suspense, useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CategoryIdSchema,
  ImportJobIdSchema,
  YearMonthSchema,
  type YearMonth,
} from '@warimaru/domain'
import { MonthNavigator } from '@/components/dashboard/MonthNavigator'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { BulkClassificationEntry } from '@/components/classification/BulkClassificationEntry'
import { RetroactivePrompt } from '@/components/classification/RetroactivePrompt'
import {
  ClassificationFields,
  classificationBody,
  classificationValid,
  type ClassificationInput,
} from '@/components/classification/ClassificationFields'
import { useMasters } from '@/components/classification/useMasters'
import { apiFetch, apiMutate } from '@/lib/api-client'
import {
  TransactionListWireSchema,
  UnclassifiedSummaryWireSchema,
  UnknownResponseSchema,
  type ExpenseClassWire,
  type TransactionListItemWire,
} from '@/lib/api-schemas'
import { EXPENSE_CLASS_LABELS, expenseClassLabel } from '@/lib/labels'
import { formatMoney } from '@/lib/format'
import { formatDate, formatMonthLabel, getCurrentMonth } from '@/lib/month'
import { LuPlus } from '@/components/ui/icons'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

type ClassFilter = ExpenseClassWire | 'all'

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

interface CreateModalProps {
  month: YearMonth
  onClose: () => void
}

function CreateModal({ month, onClose }: CreateModalProps) {
  const queryClient = useQueryClient()
  const masters = useMasters()
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
          masters={masters}
        />
      )}
      {mutation.error && <ErrorState>{mutation.error.message}</ErrorState>}
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
  const masters = useMasters()
  const [merchantName, setMerchantName] = useState(transaction.merchantName ?? '')
  const [amount, setAmount] = useState(
    transaction.amount !== null ? String(transaction.amount) : '',
  )
  const [occurredAt, setOccurredAt] = useState(() => toDateInputValue(transaction.occurredAt))
  const [classification, setClassification] = useState<ClassificationInput>({
    categoryId: transaction.categoryId ?? '',
    expenseClass: transaction.expenseClass,
  })
  // 分類の確定後に開く「過去未分類への遡及」の確認（J-3・AT-203）
  const [retroactiveFor, setRetroactiveFor] = useState<string | null>(null)

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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
      // 手動分類はその場で学習ルールになる（I-1 即時反映）。同じ加盟店で未分類の
      // まま残っている過去の取引があれば、続けて遡及の確認を出す（J-3）。
      // 加盟店名が見えない行（配偶者の個人取引）は下の editable=false で分類自体が
      // できないため、この分岐は保険
      if (transaction.merchantName === null) {
        onClose()
        return
      }
      setRetroactiveFor(transaction.merchantName)
    },
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
  const closeRetroactive = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['transactions'] })
    onClose()
  }, [queryClient, onClose])

  if (retroactiveFor !== null) {
    return (
      <Modal title="過去の取引にも適用" onClose={closeRetroactive}>
        <RetroactivePrompt merchantName={retroactiveFor} onDone={closeRetroactive} />
      </Modal>
    )
  }

  return (
    <Modal title={transaction.isUnclassified ? '未分類取引' : '取引の編集'} onClose={onClose}>
      {!editable && (
        // 権限による制限であることは文言側で伝えている(usability 2-2)。汎用の空文言には落とさない。
        // モーダルを開いた時点で確定していて切り替わらないため、読み上げは重ねない
        <EmptyState announce={false}>
          配偶者の個人取引のため、詳細の閲覧・編集はできません
        </EmptyState>
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
            masters={masters}
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
      {error && <ErrorState>{error.message}</ErrorState>}
    </Modal>
  )
}

/** Deep Link の month パラメータ。YYYY-MM として不正なら当月にフォールバック */
function parseMonthParam(value: string | null): YearMonth {
  const parsed = YearMonthSchema.safeParse(value)
  return parsed.success ? parsed.data : getCurrentMonth()
}

/** 取込完了からの Deep Link。ULID として不正なら「取込起因なし」として扱う */
function parseImportJobParam(value: string | null): string | null {
  const parsed = ImportJobIdSchema.safeParse(value)
  return parsed.success ? parsed.data : null
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
  // CSV 取込完了から来た場合の取込ジョブ ID（一括分類を「CSV取込起因」で始める）
  const importJobId = parseImportJobParam(searchParams.get('importJobId'))
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

  const unclassifiedCount = summaryQuery.data?.count ?? 0

  const items = listQuery.data ?? []
  const total = items.reduce((sum, item) => sum + (item.amount ?? 0), 0)

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>取引一覧</h1>
      <MonthNavigator month={month} onMonthChange={setMonth} />

      {summaryQuery.error && (
        <>
          <ErrorState>未分類の件数を取得できませんでした</ErrorState>
          <button className={ui.buttonGhost} onClick={() => void summaryQuery.refetch()}>
            再読み込み
          </button>
        </>
      )}

      {summaryQuery.data && (
        <BulkClassificationEntry
          month={month}
          unclassifiedCount={unclassifiedCount}
          importJobId={importJobId}
          onFilterUnclassified={() => setUnclassifiedOnly(true)}
        />
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

      {listQuery.isLoading && <LoadingState />}
      {listQuery.error && <ErrorState>取引一覧の取得に失敗しました</ErrorState>}

      {!listQuery.isLoading && !listQuery.error && (
        <>
          <div className={styles.totalRow}>
            <span>{items.length} 件</span>
            <span className={styles.totalAmount}>{formatMoney(total)}</span>
          </div>
          {items.length === 0 ? (
            // 一覧の各行が個別にカード化されているため、空状態にも同じ器を与えて背景に浮かせない
            <div className={ui.card}>
              <EmptyState>この条件の取引はありません</EmptyState>
            </div>
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
    <Suspense fallback={<LoadingState announce={false} />}>
      <TransactionsPageContent />
    </Suspense>
  )
}
