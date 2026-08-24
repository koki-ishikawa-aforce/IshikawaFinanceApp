'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { apiFetch, describeRequestFailure } from '@/lib/api-client'
import {
  AccountBalanceListWireSchema,
  AssetTotalWireSchema,
  BalanceTimeSeriesWireSchema,
  type AccountBalanceItemWire,
  type BalanceFreshnessItemWire,
} from '@/lib/api-schemas'
import { formatMoney } from '@/lib/format'
import { partnerOf } from '@/lib/partner'
import { formatDateWithYear, getCurrentMonth, shiftMonth } from '@/lib/month'
import { useViewerRole } from '@/hooks/useViewerRole'
import type { Theme } from '@/theme/tokens'
import { TimeSeriesChart, type ChartSeries } from '@/components/balances/TimeSeriesChart'
import { FreshnessBadge, useBalanceFreshnessQuery } from '@/components/balances/BalanceFreshness'
import { RoleIcon } from '@/components/ui/RoleIcon'
import {
  LuLandmark,
  LuCreditCard,
  LuPiggyBank,
  LuTrendingUp,
  LuChevronRight,
} from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

const RANGE_OPTIONS = [
  { months: 6, label: '6ヶ月' },
  { months: 12, label: '1年' },
  { months: 24, label: '2年' },
] as const

/**
 * 口座 1 件の行。押すと口座詳細（#406）へ入る。
 *
 * 相手の合計行（`SpouseSharedTotalItem`）は口座 1 件ではないため、こちらを通さない
 * ＝押せない。口座ごとの中身は本人しか見られないので、行けない先への導線を出さない。
 */
function BalanceItemLink({ accountId, children }: { accountId: string; children: ReactNode }) {
  return (
    <Link href={`/accounts?id=${accountId}`} className={styles.balanceItemLink}>
      {children}
      {/* 押せることの手がかり。相手の合計行（押せない）と見分けが付くようにする */}
      <LuChevronRight aria-hidden="true" className={`${ui.iconSm} ${styles.itemChevron}`} />
    </Link>
  )
}

function BalanceItem({
  item,
  freshness,
}: {
  item: AccountBalanceItemWire
  freshness?: BalanceFreshnessItemWire
}) {
  return (
    <BalanceItemLink accountId={item.accountId}>{balanceItemBody(item, freshness)}</BalanceItemLink>
  )
}

function balanceItemBody(item: AccountBalanceItemWire, freshness?: BalanceFreshnessItemWire) {
  switch (item.kind) {
    case 'smbc_bank':
      return (
        <div className={styles.balanceItem}>
          <div className={styles.balanceHead}>
            <LuLandmark className={`${ui.iconSm} ${styles.balanceIcon}`} aria-hidden="true" />
            <span className={styles.balanceName}>{item.displayName}</span>
          </div>
          <span className={styles.balanceValue}>{formatMoney(item.currentBalance)}</span>
          <span className={styles.balanceMeta}>更新: {formatDateWithYear(item.lastUpdatedAt)}</span>
        </div>
      )
    case 'mitsui_sumitomo_card':
      return (
        <div className={styles.balanceItem}>
          <div className={styles.balanceHead}>
            <LuCreditCard className={`${ui.iconSm} ${styles.balanceIcon}`} aria-hidden="true" />
            <span className={styles.balanceName}>{item.displayName}</span>
          </div>
          <span className={`${styles.balanceValue} ${styles.negative}`}>
            -{formatMoney(item.currentMonthUnpaidTotal)}
          </span>
          <span className={styles.balanceMeta}>
            当月未払い
            {item.lastSettledAt !== null &&
              ` ・ 前回精算: ${formatDateWithYear(item.lastSettledAt)}`}
          </span>
        </div>
      )
    case 'other_savings':
      return (
        <div className={styles.balanceItem}>
          <div className={styles.balanceHead}>
            <LuPiggyBank className={`${ui.iconSm} ${styles.balanceIcon}`} aria-hidden="true" />
            <span className={styles.balanceName}>{item.displayName}</span>
            <FreshnessBadge freshness={freshness} />
          </div>
          <span className={styles.balanceValue}>{formatMoney(item.currentBalance)}</span>
          <span className={styles.balanceMeta}>更新: {formatDateWithYear(item.lastUpdatedAt)}</span>
        </div>
      )
    case 'nisa':
      return (
        <div className={styles.balanceItem}>
          <div className={styles.balanceHead}>
            <LuTrendingUp className={`${ui.iconSm} ${styles.balanceIcon}`} aria-hidden="true" />
            <span className={styles.balanceName}>{item.displayName}</span>
          </div>
          <span className={styles.balanceValue}>{formatMoney(item.currentAccumulated)}</span>
          <span className={styles.balanceMeta}>
            積立累計 ・ 更新: {formatDateWithYear(item.lastUpdatedAt)}
          </span>
        </div>
      )
  }
}

/**
 * 相手の「別銀行貯蓄 + NISA 積立累計」の合計 1 行（P2-B5 / AT-404）。
 *
 * 口座ごとの残高は本人のみが見られるため、相手の分は銀行名も件数も出さず合計だけを出す。
 * 黙って伏せると「相手は貯めていない」に読めるため、合計だけ公開であることを明示する
 * （docs/design/usability.md 2-1）。
 *
 * 受け取るのは確定した閲覧者の役割で、画面テーマ（未確定のうちは darling に倒れる）は
 * 使わない。誰の金額かが唯一の意味を持つ行なので、確定前の既定値で名前を出して
 * あとから差し替えると、一瞬でも他人の名前が相手の金額に付く（usability.md 7-2）。
 */
function SpouseSharedTotalItem({ total, viewerRole }: { total: number; viewerRole: Theme }) {
  const partner = partnerOf(viewerRole)
  return (
    <div className={`${styles.balanceItem} ${styles.spouseItem}`}>
      <div className={styles.balanceHead}>
        <RoleIcon role={partner.role} className={`${ui.iconSm} ${styles.spouseIcon}`} />
        <span className={`${styles.balanceName} ${styles.spouseText}`}>
          {partner.name}の貯蓄・NISA（合計のみ）
        </span>
      </div>
      <span className={`${styles.balanceValue} ${styles.spouseText}`}>{formatMoney(total)}</span>
      <span className={styles.balanceMeta}>口座ごとの内訳はパートナーのみ閲覧可</span>
    </div>
  )
}

export default function BalancesPage() {
  const [rangeMonths, setRangeMonths] = useState<number>(6)
  // 相手の合計行の名前は「確定した役割」に限る。テーマ（useTheme）は取得前 darling に
  // 倒れるため、名前の根拠には使わない（usability.md 7-2）
  const viewerRoleQuery = useViewerRole()

  const listQuery = useQuery({
    queryKey: ['balances', 'list'],
    queryFn: () => apiFetch('/api/balances', AccountBalanceListWireSchema),
  })

  const totalQuery = useQuery({
    queryKey: ['balances', 'total'],
    queryFn: () => apiFetch('/api/balances/total', AssetTotalWireSchema),
  })

  // 鮮度の判定（閾値 35 日 = OQ-44）は家計分析の Query 側で行われる
  const freshnessQuery = useBalanceFreshnessQuery()
  const freshnessByAccountId = new Map(
    (freshnessQuery.data?.items ?? []).map(item => [item.accountId, item]),
  )
  // 一覧だけ先に描くと「未更新タグが後から生える」ちらつきになるため、
  // 鮮度が確定（成功・失敗いずれか）するまで口座行を描かない。
  // 閲覧者の役割も同じ扱いにする（確定前に描くと相手の合計行に別の名前が付く）
  const balanceListReady =
    listQuery.data !== undefined && !freshnessQuery.isPending && !viewerRoleQuery.isPending

  const to = getCurrentMonth()
  const from = shiftMonth(to, -(rangeMonths - 1))
  const seriesQuery = useQuery({
    queryKey: ['balances', 'time-series', from, to],
    queryFn: () =>
      apiFetch(`/api/balances/time-series?from=${from}&to=${to}`, BalanceTimeSeriesWireSchema),
  })

  const chartSeries: ChartSeries[] = seriesQuery.data
    ? [
        { label: 'SMBC', cssColorVar: '--cat-housing', points: seriesQuery.data.smbc },
        {
          label: 'その他貯蓄',
          cssColorVar: '--cat-food',
          points: seriesQuery.data.otherSavings,
        },
        {
          label: 'NISA積立',
          cssColorVar: '--cat-entertainment',
          points: seriesQuery.data.nisaContribution,
        },
        {
          label: 'カード未払い',
          cssColorVar: '--cat-other',
          points: seriesQuery.data.cardUnpaid,
        },
      ]
    : []

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>口座残高・資産推移</h1>

      {totalQuery.data && (
        <div className={styles.heroCard}>
          {/* 一覧は本人の口座だけになったが、合計は世帯のまま（OQ-60 ②）。
              どちらの範囲の数字かを書かないと、下の一覧と合わない理由が画面上で解けない */}
          <span className={styles.heroLabel}>資産合計（夫婦 2 人分）</span>
          <span className={styles.heroValue}>{formatMoney(totalQuery.data.total)}</span>
          <div className={styles.heroBreakdown}>
            <span>SMBC {formatMoney(totalQuery.data.smbcBalance)}</span>
            <span>貯蓄 {formatMoney(totalQuery.data.otherSavingsBalance)}</span>
            <span>NISA {formatMoney(totalQuery.data.nisaContributionAccumulated)}</span>
            <span>未払い -{formatMoney(totalQuery.data.cardUnpaidTotal)}</span>
          </div>
        </div>
      )}
      {totalQuery.error && (
        <ErrorState>
          {describeRequestFailure(totalQuery.error, '資産合計の取得に失敗しました')}
        </ErrorState>
      )}

      <div className={ui.card}>
        <span className={ui.sectionTitle}>口座残高</span>
        {/* 読み込み中 → 一覧 / 空 / エラー に入れ替わる領域（docs/design/usability.md 8-4）。
            入れ替わる側は announce={false} で live region の入れ子を避ける。
            器が status のため、この中のエラーは alert ではなく polite で通知される
            （器を alert にすると読み込み中まで割り込むため、こちらを採る） */}
        <div role="status">
          {(listQuery.isLoading || (listQuery.data !== undefined && !balanceListReady)) && (
            <LoadingState announce={false} />
          )}
          {listQuery.error && (
            <ErrorState announce={false}>
              {describeRequestFailure(listQuery.error, '残高一覧の取得に失敗しました')}
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
          {balanceListReady &&
            (listQuery.data.items.length === 0 &&
            listQuery.data.spouseOtherSavingsAndNisaTotal === null ? (
              <EmptyState announce={false}>
                あなたの口座がまだ登録されていません。設定の「口座」から登録してください
              </EmptyState>
            ) : (
              <div className={styles.balanceList}>
                {listQuery.data.items.map(item => (
                  <BalanceItem
                    key={item.accountId}
                    item={item}
                    freshness={freshnessByAccountId.get(item.accountId)}
                  />
                ))}
                {listQuery.data.spouseOtherSavingsAndNisaTotal !== null &&
                  (viewerRoleQuery.data === undefined ? (
                    // 誰の金額かを言えないまま出すと相手を取り違えるため、金額ごと出さない
                    <ErrorState
                      announce={false}
                      onRetry={() => void viewerRoleQuery.refetch()}
                      isRetrying={viewerRoleQuery.isFetching}
                    >
                      {describeRequestFailure(
                        viewerRoleQuery.error,
                        'パートナーの貯蓄・NISA の合計は表示できませんでした',
                      )}
                    </ErrorState>
                  ) : (
                    <SpouseSharedTotalItem
                      total={listQuery.data.spouseOtherSavingsAndNisaTotal}
                      viewerRole={viewerRoleQuery.data.role}
                    />
                  ))}
              </div>
            ))}
        </div>
      </div>

      <div className={ui.card}>
        <div className={ui.rowBetween}>
          <span className={ui.sectionTitle}>資産推移</span>
          <div className={styles.rangeToggle}>
            {RANGE_OPTIONS.map(option => (
              <button
                key={option.months}
                className={
                  rangeMonths === option.months
                    ? `${styles.rangeButton} ${styles.rangeActive}`
                    : styles.rangeButton
                }
                // 選択中は塗りの違いだけで伝えており、色に頼らない識別が要る（DESIGN.md §6）
                aria-pressed={rangeMonths === option.months}
                onClick={() => setRangeMonths(option.months)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {seriesQuery.isLoading && <LoadingState />}
        {seriesQuery.error && (
          <ErrorState>
            {describeRequestFailure(seriesQuery.error, '資産推移の取得に失敗しました')}
          </ErrorState>
        )}
        {seriesQuery.data && <TimeSeriesChart series={chartSeries} />}
      </div>
    </main>
  )
}
