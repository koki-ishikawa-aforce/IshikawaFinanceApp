'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { YearMonth } from '@warimaru/domain'
import { ApiError, apiFetch, apiMutate, describeRequestFailure } from '@/lib/api-client'
import {
  BulkClassificationSessionWireSchema,
  CurrentBulkSessionWireSchema,
  TransactionListWireSchema,
  type InProgressBulkClassificationSessionWire,
} from '@/lib/api-schemas'
import { LuTriangleAlert } from '@/components/ui/icons'
import { BulkClassificationModal } from './BulkClassificationModal'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './BulkClassificationEntry.module.css'

interface BulkClassificationEntryProps {
  /** 表示中の月。対象の未分類取引はこの月から集める */
  month: YearMonth
  /** 表示中の月の未分類件数（0 なら開始の導線は出さない） */
  unclassifiedCount: number
  /**
   * CSV 取込完了から来た場合の取込ジョブ ID。
   * 08b の取込起因のうち「CSV取込起因」で始めるために引き継ぐ
   */
  importJobId: string | null
  /** 未分類アラートを押したとき（一覧を未分類のみに絞る） */
  onFilterUnclassified: () => void
}

/**
 * 未分類アラートと一括分類セッションの導線（spec §7.1「未分類アラート + 一括分類ボタン」）。
 *
 * API は 1 ユーザー 1 セッションに限定しているため、途中離脱した進行中セッションを
 * 拾い直せないと以後まとめて分類を始められなくなる。開始・再開・中断のすべてを
 * ここに集約する。
 */
export function BulkClassificationEntry({
  month,
  unclassifiedCount,
  importJobId,
  onFilterUnclassified,
}: BulkClassificationEntryProps) {
  const queryClient = useQueryClient()
  const [openSession, setOpenSession] = useState<InProgressBulkClassificationSessionWire | null>(
    null,
  )

  const currentSessionQuery = useQuery({
    queryKey: ['classification', 'bulk-session', 'current'],
    queryFn: () =>
      apiFetch('/api/classification/bulk-sessions/current', CurrentBulkSessionWireSchema),
  })
  const resumableSession =
    currentSessionQuery.data?.session?.kind === 'in_progress'
      ? currentSessionQuery.data.session
      : null

  const startBulk = useMutation({
    mutationFn: async () => {
      // 未分類取引は所有者本人にしかリスト掲載されない（プライバシールール 4）ため、
      // 表示月の未分類行がそのまま対象になる（配偶者の取引は混ざらない）
      const unclassified = await apiFetch(
        `/api/transactions?month=${month}&isUnclassifiedOnly=true`,
        TransactionListWireSchema,
      )
      const transactionIds = unclassified
        .filter(item => item.isUnclassified)
        .map(item => item.transactionId)
      const originId = transactionIds[0]
      if (originId === undefined) {
        throw new Error('この月に未分類の取引はありません。月を切り替えてお試しください。')
      }
      return apiMutate(
        '/api/classification/bulk-sessions',
        {
          method: 'POST',
          body: {
            // 08b の取込起因は「CSV取込起因（CSV取込ID）」か「単発修正起因（取引ID）」。
            // 取込完了から来たときは前者、取引一覧から始めたときは後者で、
            // このセッションが最初に修正する取引（先頭の対象）を起点として記録する
            trigger:
              importJobId !== null
                ? { kind: 'csv_import', importJobId }
                : { kind: 'single_correction', transactionId: originId },
            transactionIds,
          },
        },
        BulkClassificationSessionWireSchema,
      )
    },
    onSuccess: async created => {
      if (created.kind === 'in_progress') setOpenSession(created)
      await queryClient.invalidateQueries({ queryKey: ['classification', 'bulk-session'] })
    },
  })

  const resume = useMutation({
    mutationFn: async (target: InProgressBulkClassificationSessionWire) => {
      // セッションの対象は開始時点で固定され、サーバーに進捗は残らない。
      // 再開時に「もう分類した取引」を外し、まだ未分類のものだけを提示する
      // （一覧に無い取引＝別の月の対象はそのまま残す）
      const listed = await apiFetch(`/api/transactions?month=${month}`, TransactionListWireSchema)
      const classifiedIds = new Set(
        listed.filter(item => !item.isUnclassified).map(item => item.transactionId),
      )
      return {
        ...target,
        common: {
          ...target.common,
          targets: target.common.targets.filter(item => !classifiedIds.has(item.transactionId)),
        },
      }
    },
    onSuccess: setOpenSession,
  })

  if (currentSessionQuery.isPending) {
    return <LoadingState>未分類の取引を確認中...</LoadingState>
  }

  if (currentSessionQuery.error) {
    // 進行中セッションの有無が分からないままだと、開始しても必ず失敗する
    // （1 ユーザー 1 セッション）ため、開始の導線は出さずに再試行を促す
    return (
      <div className={styles.section}>
        <ErrorState>
          {describeRequestFailure(
            currentSessionQuery.error,
            'まとめて分類の状況を取得できませんでした。',
          )}
        </ErrorState>
        <button className={ui.buttonGhost} onClick={() => void currentSessionQuery.refetch()}>
          再読み込み
        </button>
      </div>
    )
  }

  if (unclassifiedCount === 0 && resumableSession === null) return null

  return (
    <div className={styles.section}>
      {unclassifiedCount > 0 && (
        <button className={`${ui.card} ${styles.banner}`} onClick={onFilterUnclassified}>
          <LuTriangleAlert aria-hidden="true" className={`${ui.iconSm} ${styles.bannerIcon}`} />
          <span role="status">未分類の取引が {unclassifiedCount} 件あります</span>
        </button>
      )}
      {resumableSession !== null ? (
        <>
          <p className={styles.note} role="status">
            まとめて分類が途中のままです。続けると、まだ未分類の取引だけを分類できます。これをおえるか、やめるまで、ほかの月のまとめて分類は始められません。
          </p>
          {resume.error && (
            <ErrorState>
              {describeRequestFailure(
                resume.error,
                '続きを開けませんでした。通信状態を確かめて、もう一度お試しください。',
              )}
            </ErrorState>
          )}
          <button
            className={ui.button}
            disabled={resume.isPending}
            onClick={() => resume.mutate(resumableSession)}
          >
            {resume.isPending ? '準備中...' : 'まとめて分類を続ける'}
          </button>
        </>
      ) : (
        <button
          className={ui.button}
          disabled={startBulk.isPending}
          onClick={() => startBulk.mutate()}
        >
          {startBulk.isPending ? '準備中...' : '未分類をまとめて分類する'}
        </button>
      )}
      {startBulk.error && <ErrorState>{startErrorMessage(startBulk.error)}</ErrorState>}
      {openSession && (
        <BulkClassificationModal
          session={openSession}
          onClose={() => {
            setOpenSession(null)
            void queryClient.invalidateQueries({ queryKey: ['classification', 'bulk-session'] })
          }}
        />
      )}
    </div>
  )
}

/**
 * 開始に失敗した理由を次の行動つきで示す（usability 3-6）。
 * 進行中セッションが残っているケース（サーバーが 409 で拒否）は、再試行では
 * 解消しないので再開の導線へ案内する。
 */
function startErrorMessage(error: Error): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'すでに始めているまとめて分類があります。画面を再読み込みして、続きをおえるかやめてからお試しください。'
    }
    return 'まとめて分類を始められませんでした。通信状態を確かめて、もう一度お試しください。'
  }
  // 通信の失敗（共通文言）と、対象が 0 件だったときなど画面側で組み立てた案内は
  // どちらも message をそのまま出す
  return error.message
}
