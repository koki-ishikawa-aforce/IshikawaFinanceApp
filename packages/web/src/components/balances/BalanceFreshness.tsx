'use client'

/**
 * 残高鮮度（OQ-44: 閾値 35 日、通知先は画面表示のみ）の表示部品。
 *
 * 鮮度状態（`ok` / `alert`）は家計分析の Query が判定済みで、ここでは閾値を
 * 再判定しない。残高一覧・月次レポートの両画面で同じバッジを使い、同じ状態が
 * 画面ごとに違う重さで見えないようにする。
 */
import { useQuery } from '@tanstack/react-query'
import { apiFetch, describeRequestFailure } from '@/lib/api-client'
import { BalanceFreshnessListWireSchema, type BalanceFreshnessItemWire } from '@/lib/api-schemas'
import { formatDateWithYear } from '@/lib/month'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './BalanceFreshness.module.css'

/** 残高鮮度の取得。2 画面で同じキーを共有し、二重取得にならないようにする */
export function useBalanceFreshnessQuery() {
  return useQuery({
    queryKey: ['balances', 'freshness'],
    queryFn: () => apiFetch('/api/dashboard/balance-freshness', BalanceFreshnessListWireSchema),
  })
}

/** 鮮度アラートのバッジ。鮮度OK・未取得（undefined）のときは何も描かない */
export function FreshnessBadge({ freshness }: { freshness: BalanceFreshnessItemWire | undefined }) {
  if (freshness === undefined || freshness.status !== 'alert') return null
  return <span className={ui.badgeWarning}>{freshness.daysSinceLastUpdate}日未更新</span>
}

/**
 * 月次レポート画面に置く「貯蓄残高の更新状況（現在）」カード。
 *
 * 鮮度は月に依存しない現在時点の評価のため、見出しで「現在」であることを明示する
 * （画面上部の月切り替えの影響を受けない）。
 */
export function BalanceFreshnessCard() {
  const freshnessQuery = useBalanceFreshnessQuery()

  return (
    <div className={ui.card}>
      <h2 className={ui.sectionTitle}>貯蓄残高の更新状況（現在）</h2>
      {/*
        取得中 → 一覧 / 空 / エラー に入れ替わる領域。ページ遷移を伴わないため
        role="status" をこの器に常設する（docs/design/usability.md 8-4）。
        入れ替わる側の LoadingState / ErrorState / EmptyState は announce={false} で
        live region の入れ子を避ける
      */}
      <div role="status">
        {freshnessQuery.isPending && <LoadingState announce={false} />}
        {freshnessQuery.isError && (
          <ErrorState
            announce={false}
            onRetry={() => void freshnessQuery.refetch()}
            isRetrying={freshnessQuery.isFetching}
          >
            {describeRequestFailure(freshnessQuery.error, '更新状況を取得できませんでした')}
          </ErrorState>
        )}
        {freshnessQuery.data &&
          (freshnessQuery.data.items.length === 0 ? (
            <EmptyState announce={false}>
              設定から別銀行貯蓄口座を追加すると、ここに更新状況が出ます
            </EmptyState>
          ) : (
            <ul className={styles.list}>
              {freshnessQuery.data.items.map(item => (
                <li key={item.accountId} className={ui.rowBetween}>
                  <span className={styles.name}>{item.displayName}</span>
                  <span className={styles.meta}>
                    {formatDateWithYear(item.lastUpdatedAt)}時点
                    <FreshnessBadge freshness={item} />
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  )
}
