'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, describeRequestFailure, NetworkError } from '@/lib/api-client'
import {
  CategoryListWireSchema,
  ExpenseTypeListWireSchema,
  MerchantLearningRuleListWireSchema,
  UnknownResponseSchema,
  type LearningRefsWire,
  type MerchantLearningRuleWire,
} from '@/lib/api-schemas'
import { LEARNING_AXIS_LABELS, learnedAxisLabels } from '@/lib/labels'
import { formatDateWithYear } from '@/lib/month'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './LearningRulesTab.module.css'

/**
 * 学習ルールが持つ ID を名前へ解決するためのマスタ。
 *
 * ルール本体とは別の API から来るため、読み込み中・失敗もルール一覧と同じ状態として扱う
 * (名前が引けないまま ID や「（不明）」を先に見せると、直後に本来の名前へ差し替わってちらつく)。
 */
interface MastersState {
  isPending: boolean
  error: Error | null
  /** 再取得も含めて通信中か。再読み込みの進行中を出すために使う */
  isFetching: boolean
  refetch: () => void
  categoryNameOf: (categoryId: string) => string | undefined
  expenseTypeNameOf: (expenseTypeId: string) => string | undefined
}

function LoadFailure({
  error,
  message,
  onRetry,
  isRetrying,
}: {
  error: unknown
  message: string
  onRetry: () => void
  isRetrying: boolean
}) {
  return (
    <ErrorState onRetry={onRetry} isRetrying={isRetrying}>
      {describeRequestFailure(error, message)}
    </ErrorState>
  )
}

function LearnedAxes({ refs, masters }: { refs: LearningRefsWire; masters: MastersState }) {
  return (
    <dl className={styles.axes}>
      {learnedAxisLabels(refs, masters.categoryNameOf, masters.expenseTypeNameOf).map(axis => (
        <div key={axis.axis} className={styles.axisRow}>
          <dt className={styles.axisName}>{LEARNING_AXIS_LABELS[axis.axis]}</dt>
          <dd className={axis.learned ? styles.axisValue : styles.axisUnlearned}>{axis.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------- 加盟店学習ルール ----------

type MerchantAction = 'disable' | 'reenable'

const MERCHANT_ACTION_TEXT: Record<
  MerchantAction,
  { label: string; pending: string; description: string; destructive: boolean; result: string }
> = {
  disable: {
    label: '学習を止める',
    pending: '停止中...',
    description:
      'この加盟店について覚えた内容を消し、以後は手動で分類しても覚え直しません。取り込んだ取引は毎回未分類のままになります。あとから学習を再開できますが、消えた内容は戻りません。',
    destructive: true,
    result: 'の学習を止めました',
  },
  reenable: {
    label: '学習を再開する',
    pending: '再開中...',
    description:
      'この加盟店の学習を再開します。覚えている内容が無い状態から始まるため、次にあなたが手動で分類したときの内容を覚え直します。',
    destructive: false,
    result: 'の学習を再開しました',
  },
}

function MerchantActionModal({
  merchantName,
  action,
  onClose,
  onDone,
}: {
  merchantName: string
  action: MerchantAction
  onClose: () => void
  onDone: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const text = MERCHANT_ACTION_TEXT[action]

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/classification/merchant-rules/${action}`,
        { method: 'POST', body: { merchantName } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['classification', 'merchant-rules'] })
      onDone(`「${merchantName}」${text.result}`)
    },
  })

  return (
    <Modal title={`「${merchantName}」の${text.label}`} onClose={onClose}>
      <p className={text.destructive ? ui.warning : ui.note}>{text.description}</p>
      {mutation.error && (
        <ErrorState>
          {mutation.error.message}
          {/* 通信の失敗の文言はそれ自体が次の行動（電波の良い場所でやり直す）を含むため、
              「時間をおいて」を重ねない。次の行動が 2 つ並ぶと、どちらをすべきか決められない */}
          {!(mutation.error instanceof NetworkError) && (
            <span className={styles.errorHint}>時間をおいて、もう一度お試しください。</span>
          )}
        </ErrorState>
      )}
      <button
        className={text.destructive ? ui.buttonDanger : ui.button}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? text.pending : text.label}
      </button>
    </Modal>
  )
}

function MerchantRuleRow({
  rule,
  masters,
  onAction,
}: {
  rule: MerchantLearningRuleWire
  masters: MastersState
  onAction: (action: MerchantAction) => void
}) {
  return (
    <li className={styles.ruleRow}>
      <div className={ui.rowBetween}>
        <span className={styles.ruleName}>{rule.common.merchantName}</span>
        <span className={rule.kind === 'active' ? ui.badge : `${ui.badge} ${styles.badgeStopped}`}>
          {rule.kind === 'active' ? '学習中' : '学習を停止中'}
        </span>
      </div>
      {rule.kind === 'active' ? (
        <>
          <LearnedAxes refs={rule} masters={masters} />
          <span className={styles.ruleMeta}>
            最終更新日: {formatDateWithYear(rule.lastUpdatedAt)}
          </span>
          <button
            className={`${ui.textButton} ${ui.textButtonDanger}`}
            onClick={() => onAction('disable')}
            aria-label={`${rule.common.merchantName}の学習を止める`}
          >
            学習を止める
          </button>
        </>
      ) : (
        <>
          <span className={styles.ruleMeta}>停止した日: {formatDateWithYear(rule.disabledAt)}</span>
          <button
            className={ui.textButton}
            onClick={() => onAction('reenable')}
            aria-label={`${rule.common.merchantName}の学習を再開する`}
          >
            学習を再開する
          </button>
        </>
      )}
    </li>
  )
}

function MerchantRulesSection({ masters }: { masters: MastersState }) {
  const [target, setTarget] = useState<{ merchantName: string; action: MerchantAction } | null>(
    null,
  )
  // 成功はその場の表示更新で示す(トーストは採用しない)。読み上げのために live region に置く
  const [actionResult, setActionResult] = useState<string | null>(null)

  const rulesQuery = useQuery({
    queryKey: ['classification', 'merchant-rules'],
    queryFn: () =>
      apiFetch('/api/classification/merchant-rules', MerchantLearningRuleListWireSchema),
  })

  const isPending = rulesQuery.isPending || masters.isPending
  const error = rulesQuery.error ?? masters.error

  return (
    <section className={ui.card}>
      <h2 className={ui.sectionTitle}>加盟店の学習</h2>
      <p className={ui.note}>
        取引を手動で分類すると、その加盟店の分類を覚えて次回から自動で分類します。覚えた内容の確認と、加盟店ごとに学習を止める・再開することができます。ここに出るのはあなたの学習だけで、配偶者の学習とは共有されません。
      </p>
      {/* 「何度分類しても Amazon が一覧に出てこない」を不具合と誤解させないため、
          学習の対象外であることをこの画面で明示する（X-1 取り下げ、#572）。
          除外そのものを続けるかは判断待ちのため、変わったらこの文言も直す（#391） */}
      <p className={ui.note}>
        Amazon（AMAZON.CO.JP）の支払いは、加盟店名がどれも同じで中身を見分けられないため学習の対象外です。この一覧には出てこず、毎回その場で分類してください。
      </p>
      {actionResult !== null && (
        <p className={styles.actionResult} role="status">
          {actionResult}
        </p>
      )}
      {isPending && <LoadingState />}
      {!isPending && error !== null && (
        <LoadFailure
          error={error}
          message="学習ルールの取得に失敗しました"
          onRetry={() => {
            void rulesQuery.refetch()
            masters.refetch()
          }}
          isRetrying={rulesQuery.isFetching || masters.isFetching}
        />
      )}
      {!isPending &&
        error === null &&
        rulesQuery.data !== undefined &&
        (rulesQuery.data.items.length === 0 ? (
          <EmptyState>
            覚えている加盟店はまだありません。取引一覧で分類すると、その加盟店の分類をここに覚えます。
          </EmptyState>
        ) : (
          <ul className={styles.ruleList}>
            {rulesQuery.data.items.map(rule => (
              <MerchantRuleRow
                key={rule.common.merchantName}
                rule={rule}
                masters={masters}
                onAction={action => setTarget({ merchantName: rule.common.merchantName, action })}
              />
            ))}
          </ul>
        ))}
      {target !== null && (
        <MerchantActionModal
          merchantName={target.merchantName}
          action={target.action}
          onClose={() => setTarget(null)}
          onDone={message => {
            setActionResult(message)
            setTarget(null)
          }}
        />
      )}
    </section>
  )
}

// ---------- タブ ----------

/**
 * 学習ルールの管理(#400)。
 *
 * 加盟店学習ルールの一覧と、学習の停止 / 再開を表示する。
 * API は閲覧者本人のルールだけを返す(08b F-1)ため、配偶者のルールはここに現れない。
 *
 * Amazon 商品ごとの学習(X-1)は 2026-08-23 に取り下げたため一覧を持たない(#391・#572)。
 * AMAZON.CO.JP の取引は加盟店としても学習しないので、どこにも現れない。
 */
export function LearningRulesTab() {
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/categories', CategoryListWireSchema),
  })
  const expenseTypesQuery = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => apiFetch('/api/expense-types', ExpenseTypeListWireSchema),
  })

  const categoryNames = new Map(
    (categoriesQuery.data?.items ?? []).map(category => [category.categoryId, category.name]),
  )
  const expenseTypeNames = new Map(
    (expenseTypesQuery.data?.items ?? []).map(type => [type.expenseTypeId, type.name]),
  )
  const masters: MastersState = {
    isPending: categoriesQuery.isPending || expenseTypesQuery.isPending,
    error: categoriesQuery.error ?? expenseTypesQuery.error,
    isFetching: categoriesQuery.isFetching || expenseTypesQuery.isFetching,
    refetch: () => {
      void categoriesQuery.refetch()
      void expenseTypesQuery.refetch()
    },
    categoryNameOf: id => categoryNames.get(id),
    expenseTypeNameOf: id => expenseTypeNames.get(id),
  }

  return <MerchantRulesSection masters={masters} />
}
