'use client'

/**
 * 口座詳細（#406。spec §9.3「個別詳細」）。
 *
 * 残高一覧が世帯の口座を横並びで見せるのに対し、この画面は 1 口座の中身
 * （いまの値・その口座だけの推移・その口座の残高変動履歴）を見せ、別銀行貯蓄では手入力
 * （取り崩し・補正）の入口にもなる。
 *
 * 対象の口座は `?id=` で受け取る。Static Export では動的セグメント（/accounts/[id]）は
 * 事前に全 ID を書き出せないため使えない（取引一覧の月指定と同じ理由でクエリを使う）。
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ApiError, apiFetch, describeRequestFailure } from '@/lib/api-client'
import { AccountDetailWireSchema, type AccountDetailWire } from '@/lib/api-schemas'
import { formatMoney } from '@/lib/format'
import { formatDateWithYear, getCurrentMonth, shiftMonth } from '@/lib/month'
import { TimeSeriesChart } from '@/components/balances/TimeSeriesChart'
import { FreshnessBadge, useBalanceFreshnessQuery } from '@/components/balances/BalanceFreshness'
import { ManualEntryModal, type ManualEntryKind } from '@/components/accounts/ManualEntryModal'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/SegmentedControl'
import { LuChevronLeft } from '@/components/ui/icons'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

type RangeMonths = '3' | '6' | '12'

/**
 * 期間の選択肢。残高一覧の資産推移（6ヶ月 / 1年 / 2年）と違うのは、口座 1 件の推移が
 * spec §9.3 / §9.4 で 12・6・3 ヶ月と決まっているため（世帯の資産推移より短い期間を見る画面）。
 */
const RANGE_OPTIONS: readonly SegmentedControlOption<RangeMonths>[] = [
  { value: '3', label: '3ヶ月' },
  { value: '6', label: '6ヶ月' },
  { value: '12', label: '1年' },
]

/** hero に出す金額の呼び名。口座種別ごとに意味が違うので、金額だけを出さない */
const VALUE_LABELS: Record<AccountDetailWire['kind'], string> = {
  smbc_bank: '残高',
  mitsui_sumitomo_card: '当月未払い',
  other_savings: '残高',
  nisa: '積立累計',
}

/** 最終更新日時の呼び名。カードだけは「更新」ではなく前回の精算日 */
const UPDATED_LABELS: Record<AccountDetailWire['kind'], string> = {
  smbc_bank: '更新',
  mitsui_sumitomo_card: '前回精算',
  other_savings: '更新',
  nisa: '更新',
}

const HISTORY_SOURCE_LABELS: Record<AccountDetailWire['history'][number]['source'], string> = {
  auto: '自動反映',
  manual_withdrawal: '取り崩し',
  manual_correction: '残高補正',
}

/** グラフの線の色。残高一覧の 4 軸と同じ割り当てにして、一覧と詳細で線の色を変えない */
const SERIES_COLOR_VARS: Record<AccountDetailWire['kind'], string> = {
  smbc_bank: '--cat-housing',
  mitsui_sumitomo_card: '--cat-other',
  other_savings: '--cat-food',
  nisa: '--cat-entertainment',
}

/**
 * 口座の値の表示。カードの未払いは残高一覧でマイナス表記のため、詳細でも符号を揃える
 * （同じ額が画面によって符号違いで出ると、増えたのか減ったのか読めなくなる）。
 */
function formatAccountValue(kind: AccountDetailWire['kind'], value: number): string {
  return kind === 'mitsui_sumitomo_card' ? `-${formatMoney(value)}` : formatMoney(value)
}

/** 増減の表示。符号を必ず付け、起点が分からない行は増減を出さない */
function formatDelta(delta: number | null): string {
  if (delta === null) return '—'
  return delta < 0 ? `-${formatMoney(-delta)}` : `+${formatMoney(delta)}`
}

/**
 * 取得に失敗した理由を、次にとる行動が分かる文言にする。
 *
 * 404 は「他人の口座」と「存在しない口座」の両方（API がこの 2 つを区別しないため）。
 * どちらも何度やり直しても結果が変わらないので、再読み込みの手段は出さない。
 */
function describeDetailFailure(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof ApiError && error.status === 404) {
    return {
      message:
        '口座ごとの残高は本人だけが見られます。残高一覧から自分の口座を選んでください（すでに無くなった口座の場合も同じ表示になります）',
      retryable: false,
    }
  }
  return {
    message: describeRequestFailure(error, 'この口座を表示できませんでした'),
    retryable: true,
  }
}

/**
 * 残高とグラフの食い違いに気づける知らせ（#566 の決定「A: 使う人に伝える」）。
 *
 * 残高を手で直すと (1) 残高そのものと (2) 推移グラフの元になる変動の記録の 2 か所が動く。
 * (2) だけが失敗しても画面には「保存しました」と出るため、残高は直った値・グラフは直す前の値、
 * という食い違いが起きたまま気づけない。ここで両方の値を突き合わせ、違っていれば知らせる。
 *
 * 記録が 1 件も無い口座（グラフに線が出ない）では比べる相手がいないので何も出さない。
 */
function GraphMismatchNotice({
  detail,
  onReload,
  isReloading,
}: {
  detail: AccountDetailWire
  onReload: () => void
  isReloading: boolean
}) {
  const latest = detail.series.at(-1)
  if (latest === undefined || latest.amount === detail.currentValue) return null
  return (
    <ErrorState onRetry={onReload} isRetrying={isReloading}>
      {VALUE_LABELS[detail.kind]}は {formatAccountValue(detail.kind, detail.currentValue)} ですが、
      下の推移グラフには {formatAccountValue(detail.kind, latest.amount)}{' '}
      までしか反映されていません。グラフへの反映が済んでいない可能性があります。
    </ErrorState>
  )
}

function AccountDetailHeader({ title }: { title: string }) {
  return (
    <div className={styles.header}>
      <Link href="/balances" className={styles.back}>
        <LuChevronLeft aria-hidden="true" className={ui.iconSm} />
        残高一覧
      </Link>
      <h1 className={ui.pageTitle}>{title}</h1>
    </div>
  )
}

function AccountDetailContent({ accountId }: { accountId: string }) {
  const [rangeMonths, setRangeMonths] = useState<RangeMonths>('6')
  const [manualEntry, setManualEntry] = useState<ManualEntryKind | null>(null)

  const to = getCurrentMonth()
  const from = shiftMonth(to, -(Number(rangeMonths) - 1))
  const detailQuery = useQuery({
    queryKey: ['balances', 'account-detail', accountId, from, to],
    queryFn: () =>
      apiFetch(
        // 口座IDは URL クエリ由来の外部入力。組み立てるパスをずらされないよう必ず符号化する
        `/api/balances/accounts/${encodeURIComponent(accountId)}?from=${from}&to=${to}`,
        AccountDetailWireSchema,
      ),
    // 期間を切り替えても残高カードまで「読み込み中」に落とさない。期間はグラフと履歴の
    // 条件であって、残高が分からなくなるわけではない
    placeholderData: keepPreviousData,
  })

  // 鮮度の判定（閾値 35 日 = OQ-44）は家計分析の Query 側で行われる。残高一覧と同じ
  // 問い合わせを共有するため、この画面のためだけに取り直さない
  const freshnessQuery = useBalanceFreshnessQuery()
  const freshness = (freshnessQuery.data?.items ?? []).find(item => item.accountId === accountId)

  const detail = detailQuery.data
  // 残高だけ先に描くと「未更新タグが後から生える」ちらつきになるため、鮮度が確定
  // （成功・失敗いずれか）するまで残高カードを描かない（残高一覧と同じ扱い）
  const heroReady = detail !== undefined && !freshnessQuery.isPending
  const failure = detailQuery.isError ? describeDetailFailure(detailQuery.error) : null

  return (
    <main className={styles.main}>
      <AccountDetailHeader title={detail?.displayName ?? '口座'} />

      {/* 取得中 → 残高 / エラー に入れ替わる領域（docs/design/usability.md 8-4）。
          入れ替わる側は announce={false} で live region の入れ子を避ける */}
      <div role="status">
        {(detailQuery.isPending || (detail !== undefined && !heroReady)) && (
          <LoadingState announce={false} />
        )}
        {failure !== null && (
          <ErrorState
            announce={false}
            {...(failure.retryable
              ? { onRetry: () => void detailQuery.refetch(), isRetrying: detailQuery.isFetching }
              : {})}
          >
            {failure.message}
          </ErrorState>
        )}
        {freshnessQuery.isError && (
          <ErrorState
            announce={false}
            onRetry={() => void freshnessQuery.refetch()}
            isRetrying={freshnessQuery.isFetching}
          >
            {describeRequestFailure(
              freshnessQuery.error,
              '残高の更新状況を取得できませんでした（未更新のお知らせは出ません）',
            )}
          </ErrorState>
        )}
        {heroReady && (
          <div className={styles.heroCard}>
            <div className={styles.heroHead}>
              <span className={styles.heroLabel}>{VALUE_LABELS[detail.kind]}</span>
              <FreshnessBadge freshness={freshness} />
              {!detail.isActive && <span className={ui.badge}>使っていない口座</span>}
            </div>
            <span className={styles.heroValue}>
              {formatAccountValue(detail.kind, detail.currentValue)}
            </span>
            <span className={styles.heroMeta}>
              {detail.lastUpdatedAt === null
                ? `${UPDATED_LABELS[detail.kind]}: まだありません`
                : `${UPDATED_LABELS[detail.kind]}: ${formatDateWithYear(detail.lastUpdatedAt)}`}
            </span>
          </div>
        )}
      </div>

      {detail && (
        <GraphMismatchNotice
          detail={detail}
          onReload={() => void detailQuery.refetch()}
          isReloading={detailQuery.isFetching}
        />
      )}

      {/* 手入力を受け付けるかは API が答える（口座種別での出し分けを画面に持たない） */}
      {detail?.supportsBalanceManualEntry && detail.isActive && (
        <div className={styles.manualActions}>
          <button className={ui.button} onClick={() => setManualEntry('withdrawal')}>
            取り崩しを記録
          </button>
          <button className={ui.buttonGhost} onClick={() => setManualEntry('correction')}>
            残高を補正
          </button>
        </div>
      )}

      {/* 取得できていないうちは見出しだけのカードを並べない（変動が 1 件も無い口座と
          見分けが付かないため）。失敗したことは上の器で 1 回だけ伝える（usability.md 1-4） */}
      {detail && (
        <>
          <div className={ui.card}>
            <h2 className={ui.sectionTitle}>{VALUE_LABELS[detail.kind]}の推移</h2>
            <SegmentedControl
              label="期間"
              options={RANGE_OPTIONS}
              value={rangeMonths}
              onChange={setRangeMonths}
            />
            <TimeSeriesChart
              // 線は 1 本。凡例には口座名ではなく金額の呼び名を出す（口座名は見出しに
              // 出ており、同じ言葉を二度置くと凡例が何を示すのか分かりにくくなる）
              series={[
                {
                  label: VALUE_LABELS[detail.kind],
                  cssColorVar: SERIES_COLOR_VARS[detail.kind],
                  points: detail.series,
                },
              ]}
            />
          </div>

          <div className={ui.card}>
            <h2 className={ui.sectionTitle}>残高の変動履歴</h2>
            <div role="status">
              {detail.history.length === 0 ? (
                <EmptyState announce={false}>
                  この期間に記録された変動はありません。期間を広げると、それ以前の記録が出ます
                </EmptyState>
              ) : (
                <ul className={styles.history}>
                  {detail.history.map(row => (
                    <li key={`${row.occurredAt.toISOString()}-${row.valueAfter}`}>
                      <div className={ui.rowBetween}>
                        <span className={styles.historyDate}>
                          {formatDateWithYear(row.occurredAt)}
                        </span>
                        <span
                          className={
                            row.delta !== null && row.delta < 0
                              ? `${styles.historyDelta} ${styles.negative}`
                              : styles.historyDelta
                          }
                        >
                          {formatDelta(row.delta)}
                        </span>
                      </div>
                      <div className={ui.rowBetween}>
                        <span className={styles.historySource}>
                          {HISTORY_SOURCE_LABELS[row.source]}
                        </span>
                        <span className={styles.historyAfter}>
                          {VALUE_LABELS[detail.kind]}{' '}
                          {formatAccountValue(detail.kind, row.valueAfter)}
                        </span>
                      </div>
                      {row.memo !== undefined && <p className={ui.note}>{row.memo}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {manualEntry !== null && detail && (
        <ManualEntryModal
          accountId={accountId}
          kind={manualEntry}
          currentBalance={detail.currentValue}
          onClose={() => setManualEntry(null)}
        />
      )}
    </main>
  )
}

function AccountDetailPageContent() {
  const accountId = useSearchParams().get('id')
  if (accountId === null || accountId === '') {
    return (
      <main className={styles.main}>
        <AccountDetailHeader title="口座" />
        <div className={ui.card}>
          <h2 className={ui.sectionTitle}>口座の詳細</h2>
          <EmptyState>
            どの口座を見るかが指定されていません。残高一覧から口座を選んでください
          </EmptyState>
        </div>
      </main>
    )
  }
  return <AccountDetailContent accountId={accountId} />
}

export default function AccountDetailPage() {
  // Static Export では useSearchParams を使うコンポーネントに Suspense 境界が必須
  return (
    <Suspense
      fallback={
        <main className={styles.main}>
          <AccountDetailHeader title="口座" />
          <div className={ui.card}>
            <LoadingState announce={false} />
          </div>
        </main>
      }
    >
      <AccountDetailPageContent />
    </Suspense>
  )
}
