'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { YearMonth } from '@warimaru/domain'
import { MonthNavigator } from '@/components/dashboard/MonthNavigator'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { apiFetch, apiMutate } from '@/lib/api-client'
import {
  CurrentCycleResponseSchema,
  DepositListWireSchema,
  ExpenseSettlementViewWireSchema,
  ExpenseTypeListWireSchema,
  UnknownResponseSchema,
  type CycleWire,
  type ExpenseTypeAccumulationWire,
} from '@/lib/api-schemas'
import { formatMoney } from '@/lib/format'
import { formatDate, formatDateTime, formatMonthLabel, getCurrentMonth } from '@/lib/month'
import { LuPlus } from '@/components/ui/icons'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

const CYCLE_LABELS: Record<CycleWire['kind'], string> = {
  accumulating: '集積中',
  csv_confirmed: 'CSV確定済み',
  finalized: '最終確定済み',
}

function AccumulationCard({
  accumulation,
  expenseTypeName,
}: {
  accumulation: ExpenseTypeAccumulationWire
  expenseTypeName: string
}) {
  const capped = accumulation.kind === 'capped'
  const ratio = capped
    ? Math.min(1, accumulation.currentTotal / Math.max(1, accumulation.monthlyCap))
    : 0

  return (
    <div className={styles.accumulation}>
      <div className={ui.rowBetween}>
        <span className={styles.accumulationName}>{expenseTypeName}</span>
        {capped && accumulation.capReached.kind === 'reached' && (
          <span className={styles.capTag}>上限到達</span>
        )}
      </div>
      <div className={ui.rowBetween}>
        <span className={styles.accumulationTotal}>{formatMoney(accumulation.currentTotal)}</span>
        <span className={styles.accumulationCap}>
          {capped ? `/ ${formatMoney(accumulation.monthlyCap)}` : '上限なし'}
        </span>
      </div>
      {capped && (
        <div className={styles.progressTrack}>
          <div
            className={
              ratio >= 1 ? `${styles.progressBar} ${styles.progressFull}` : styles.progressBar
            }
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      )}
      <span className={styles.accumulationMeta}>
        {accumulation.transactionRefs.length} 件の取引
      </span>
    </div>
  )
}

function DepositModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/expense-settlement/deposits',
        { method: 'POST', body: { depositAmount: Number(amount) } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['expense-settlement'] })
      onClose()
    },
  })

  const valid = amount !== '' && Number.isInteger(Number(amount)) && Number(amount) > 0

  return (
    <Modal title="精算入金を記録" onClose={onClose}>
      <div className={ui.field}>
        <label className={ui.fieldLabel}>入金額（円）</label>
        <input
          className={ui.input}
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="例: 25000"
        />
      </div>
      {mutation.error && <ErrorState>{mutation.error.message}</ErrorState>}
      <button
        className={ui.button}
        disabled={!valid || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '記録中...' : '突合待ちとして記録'}
      </button>
    </Modal>
  )
}

function FinalizeModal({ cycle, onClose }: { cycle: CycleWire; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [depositId, setDepositId] = useState('')

  const depositsQuery = useQuery({
    queryKey: ['expense-settlement', 'deposits-awaiting'],
    queryFn: () => apiFetch('/api/expense-settlement/deposits/awaiting', DepositListWireSchema),
  })

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/expense-settlement/cycles/${cycle.common.monthlyExpenseCycleId}/finalize`,
        { method: 'PUT', body: { expenseReimbursementId: depositId } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['expense-settlement'] })
      await queryClient.invalidateQueries({ queryKey: ['monthly-reports'] })
      onClose()
    },
  })

  const deposits = depositsQuery.data?.items ?? []

  return (
    <Modal title="サイクルを最終確定" onClose={onClose}>
      <p className={styles.note}>
        {formatMonthLabel(cycle.common.targetYearMonth)}
        のサイクルを、突合する精算入金を選んで確定します。
      </p>
      {depositsQuery.isLoading && <LoadingState />}
      {/* 取得失敗を空状態に落とすと、存在しない入金を記録しに行かせる誤った案内になる */}
      {depositsQuery.error && <ErrorState>突合待ちの入金の取得に失敗しました</ErrorState>}
      {deposits.length === 0 && !depositsQuery.isLoading && !depositsQuery.error && (
        <EmptyState>突合待ちの入金がありません。先に「精算入金を記録」してください。</EmptyState>
      )}
      {deposits.length > 0 && (
        <div className={ui.field}>
          <label className={ui.fieldLabel}>突合する入金</label>
          <select
            className={ui.select}
            value={depositId}
            onChange={e => setDepositId(e.target.value)}
          >
            <option value="">選択してください</option>
            {deposits.map(deposit => (
              <option
                key={deposit.common.expenseReimbursementId}
                value={deposit.common.expenseReimbursementId}
              >
                {formatDate(deposit.common.depositedAt)} {formatMoney(deposit.common.depositAmount)}
              </option>
            ))}
          </select>
        </div>
      )}
      {mutation.error && <ErrorState>{mutation.error.message}</ErrorState>}
      <button
        className={ui.button}
        disabled={depositId === '' || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '確定中...' : '最終確定する'}
      </button>
    </Modal>
  )
}

export default function ExpenseSettlementPage() {
  const queryClient = useQueryClient()
  const [month, setMonth] = useState<YearMonth>(getCurrentMonth)
  const [depositModal, setDepositModal] = useState(false)
  const [finalizeModal, setFinalizeModal] = useState(false)

  const viewQuery = useQuery({
    queryKey: ['expense-settlement', 'view', month],
    queryFn: () =>
      apiFetch(`/api/expense-settlement?month=${month}`, ExpenseSettlementViewWireSchema),
  })

  const cycleQuery = useQuery({
    queryKey: ['expense-settlement', 'cycle', month],
    queryFn: () =>
      apiFetch(`/api/expense-settlement/cycles?month=${month}`, CurrentCycleResponseSchema),
  })

  const expenseTypesQuery = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => apiFetch('/api/expense-types', ExpenseTypeListWireSchema),
    staleTime: 60_000,
  })
  const expenseTypeNames = new Map(
    (expenseTypesQuery.data?.items ?? []).map(t => [t.expenseTypeId, t.name]),
  )

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['expense-settlement'] })

  const startCycle = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/expense-settlement/cycles',
        { method: 'POST', body: { targetMonth: month } },
        UnknownResponseSchema,
      ),
    onSuccess: invalidate,
  })

  const cycle = cycleQuery.data?.cycle ?? null

  const confirmCsv = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/expense-settlement/cycles/${cycle?.common.monthlyExpenseCycleId}/confirm-csv`,
        { method: 'PUT', body: {} },
        UnknownResponseSchema,
      ),
    onSuccess: invalidate,
  })

  const prorate = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/expense-settlement/cycles/${cycle?.common.monthlyExpenseCycleId}/prorate`,
        { method: 'POST', body: {} },
        UnknownResponseSchema,
      ),
    onSuccess: invalidate,
  })

  const view = viewQuery.data
  const actionError = startCycle.error ?? confirmCsv.error ?? prorate.error

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>経費精算</h1>
      <MonthNavigator month={month} onMonthChange={setMonth} />

      <div className={ui.card}>
        <div className={ui.rowBetween}>
          <span className={ui.sectionTitle}>精算サイクル</span>
          {cycle !== null && (
            <span className={cycle.kind === 'finalized' ? ui.badgeAccent : ui.badge}>
              {CYCLE_LABELS[cycle.kind]}
            </span>
          )}
        </div>
        {cycleQuery.isLoading && <LoadingState />}
        {cycleQuery.error && <ErrorState>サイクルの取得に失敗しました</ErrorState>}
        {!cycleQuery.isLoading && !cycleQuery.error && cycle === null && (
          <>
            <EmptyState>この月のサイクルは未開始です</EmptyState>
            <button
              className={ui.button}
              disabled={startCycle.isPending}
              onClick={() => startCycle.mutate()}
            >
              {startCycle.isPending ? '開始中...' : 'サイクルを開始'}
            </button>
          </>
        )}
        {cycle !== null && (
          <div className={styles.cycleActions}>
            <span className={styles.cycleMeta}>
              開始: {formatDateTime(cycle.common.cycleStartedAt)}
            </span>
            {cycle.kind === 'accumulating' && (
              <>
                <button
                  className={ui.buttonGhost}
                  disabled={prorate.isPending}
                  onClick={() => prorate.mutate()}
                >
                  {prorate.isPending ? '生成中...' : '按分子取引を生成'}
                </button>
                <button
                  className={ui.button}
                  disabled={confirmCsv.isPending}
                  onClick={() => {
                    if (
                      window.confirm('CSV 確定するとこの月の集積を締め切ります。よろしいですか？')
                    ) {
                      confirmCsv.mutate()
                    }
                  }}
                >
                  {confirmCsv.isPending ? '確定中...' : 'CSV 確定'}
                </button>
              </>
            )}
            {cycle.kind === 'csv_confirmed' && (
              <button className={ui.button} onClick={() => setFinalizeModal(true)}>
                最終確定（入金突合）
              </button>
            )}
          </div>
        )}
        {actionError && <ErrorState>{actionError.message}</ErrorState>}
      </div>

      <div className={ui.card}>
        <div className={ui.rowBetween}>
          <span className={ui.sectionTitle}>費用区分別の累計</span>
          <button
            className={`${styles.smallButton} ${ui.iconLabel}`}
            aria-label="入金記録を追加"
            onClick={() => setDepositModal(true)}
          >
            <LuPlus aria-hidden="true" size="1.25em" />
            入金記録
          </button>
        </div>
        {viewQuery.isLoading && <LoadingState />}
        {viewQuery.error && <ErrorState>精算情報の取得に失敗しました</ErrorState>}
        {view &&
          (view.currentAccumulations.length === 0 ? (
            <EmptyState>当月の経費累計はまだありません</EmptyState>
          ) : (
            <div className={styles.accumulationList}>
              {view.currentAccumulations.map(accumulation => (
                <AccumulationCard
                  key={accumulation.accumulationId}
                  accumulation={accumulation}
                  expenseTypeName={
                    expenseTypeNames.get(accumulation.expenseTypeId) ?? accumulation.expenseTypeId
                  }
                />
              ))}
            </div>
          ))}
      </div>

      <div className={ui.card}>
        <span className={ui.sectionTitle}>按分子取引</span>
        {/* 直上の「費用区分別の累計」と同じ 3 状態を出す(同一画面で扱いを混在させない) */}
        {viewQuery.isLoading && <LoadingState />}
        {viewQuery.error && <ErrorState>精算情報の取得に失敗しました</ErrorState>}
        {view &&
          (view.currentChildTransactions.length === 0 ? (
            <EmptyState>当月の按分子取引はありません</EmptyState>
          ) : (
            <ul className={styles.childList}>
              {view.currentChildTransactions.map(child => (
                <li key={child.childTransactionId} className={ui.rowBetween}>
                  <div className={styles.childLeft}>
                    <span className={styles.childDate}>{formatDate(child.derivedAt)}</span>
                    <span className={styles.childTarget}>
                      {child.personalExpenseClass === 'personal_honey'
                        ? '個人(Honey)'
                        : '個人(Darling)'}
                      へ按分
                    </span>
                  </div>
                  <span className={styles.childAmount}>{formatMoney(child.personalAmount)}</span>
                </li>
              ))}
            </ul>
          ))}
      </div>

      {view?.latestFinalizedCycle && (
        <div className={ui.card}>
          <span className={ui.sectionTitle}>直近の確定サイクル</span>
          <div className={ui.rowBetween}>
            <span className={styles.childTarget}>
              {formatMonthLabel(view.latestFinalizedCycle.targetYearMonth)}分
            </span>
            <span className={styles.childDate}>
              {formatDateTime(view.latestFinalizedCycle.finalizedAt)} 確定
            </span>
          </div>
          <div className={ui.rowBetween}>
            <span className={styles.childTarget}>不認定分合計</span>
            <span className={styles.childAmount}>
              {formatMoney(view.latestFinalizedCycle.unapprovedTotal)}
            </span>
          </div>
        </div>
      )}

      {depositModal && <DepositModal onClose={() => setDepositModal(false)} />}
      {finalizeModal && cycle !== null && (
        <FinalizeModal cycle={cycle} onClose={() => setFinalizeModal(false)} />
      )}
    </main>
  )
}
