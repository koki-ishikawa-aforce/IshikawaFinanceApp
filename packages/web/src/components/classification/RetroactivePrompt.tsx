'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, apiFetch, apiMutate } from '@/lib/api-client'
import {
  RetroactiveApplyResultWireSchema,
  RetroactiveCandidatesWireSchema,
} from '@/lib/api-schemas'
import { formatMoney } from '@/lib/format'
import { formatDateWithYear } from '@/lib/month'
import ui from '@/components/ui/common.module.css'
import styles from './RetroactivePrompt.module.css'

/**
 * 適用が失敗した理由を次の行動つきで示す（usability 3-6）。
 *
 * 遡及適用は加盟店学習ルールを前提にするため（08b J-3）、学習の対象外
 * （Amazon 商品キー由来）や学習無効化中の加盟店では、通信ではなく前提の側で
 * 必ず失敗する。サーバーは学習ルール未存在を 404、無効化中を 409 で返す。
 */
function applyErrorMessage(error: Error): string {
  if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
    return 'この店舗は自動分類の学習の対象外のため、まとめて変更できません。過去の取引は 1 件ずつ分類してください。'
  }
  return 'まとめての変更に失敗しました。通信状態を確かめて、もう一度お試しください。'
}

interface RetroactivePromptProps {
  /** 直前に分類した取引の加盟店名。この加盟店の過去未分類取引が遡及の対象になる */
  merchantName: string
  /** 遡及を適用した / 見送った / 対象が無かった。いずれもこの確認を閉じる */
  onDone: () => void
}

/**
 * 過去未分類への遡及適用の確認（08b J-3・spec §7.4「過去遡及」・AT-203）。
 *
 * 手動分類の確定直後に開き、同じ加盟店で未分類のまま残っている過去の取引を
 * 提示する。適用対象は本人の未分類取引のみ（既分類・配偶者の取引は API 側で
 * 対象外。web では絞り込みを再実装しない）。
 *
 * 対象が 0 件のときは確認を出さずに閉じる（学習のたびに空のダイアログを
 * 見せない）。
 */
export function RetroactivePrompt({ merchantName, onDone }: RetroactivePromptProps) {
  const queryClient = useQueryClient()
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const [applied, setApplied] = useState<number | null>(null)

  const candidatesQuery = useQuery({
    queryKey: ['classification', 'retroactive', merchantName],
    queryFn: () =>
      apiFetch(
        `/api/classification/retroactive-candidates?merchantName=${encodeURIComponent(merchantName)}`,
        RetroactiveCandidatesWireSchema,
      ),
    // 分類のたびに最新の未分類状況を引く（前回の提案を使い回さない）
    staleTime: 0,
    gcTime: 0,
  })

  const candidates = candidatesQuery.data?.candidates ?? []
  const selectedIds = candidates
    .map(candidate => candidate.transactionId)
    .filter(id => !excluded.has(id))

  const apply = useMutation({
    mutationFn: () =>
      apiMutate(
        '/api/classification/retroactive-candidates/apply',
        { method: 'POST', body: { merchantName, transactionIds: selectedIds } },
        RetroactiveApplyResultWireSchema,
      ),
    onSuccess: async result => {
      setApplied(result.appliedCount)
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })

  const hasCandidates = candidates.length > 0
  const noCandidates = candidatesQuery.data !== undefined && !hasCandidates
  useEffect(() => {
    if (noCandidates) onDone()
  }, [noCandidates, onDone])

  if (applied !== null) {
    return (
      <>
        <div className={styles.result} role="status">
          過去の {applied} 件も同じ分類にしました。
        </div>
        <button className={ui.button} onClick={onDone}>
          閉じる
        </button>
      </>
    )
  }

  if (candidatesQuery.isPending || noCandidates) {
    return <div className={ui.loading}>過去の未分類取引を確認しています...</div>
  }

  if (candidatesQuery.error) {
    return (
      <>
        <div className={ui.error} role="alert">
          過去の未分類取引を確認できませんでした。この取引の分類は保存済みです。
        </div>
        <button className={ui.buttonGhost} onClick={() => void candidatesQuery.refetch()}>
          もう一度確認する
        </button>
        <button className={ui.button} onClick={onDone}>
          閉じる
        </button>
      </>
    )
  }

  return (
    <>
      <p className={styles.lead} role="status">
        過去にも未分類の「{merchantName}」の取引が {candidates.length} 件あります。
        まとめて同じ分類にしますか？
      </p>
      <ul className={styles.list}>
        {candidates.map(candidate => (
          <li key={candidate.transactionId}>
            {/* 日付と金額の両方をラベルに含める（どの取引か音声だけで判別できるように） */}
            <label className={`${ui.card} ${styles.row}`}>
              <input
                type="checkbox"
                checked={!excluded.has(candidate.transactionId)}
                onChange={() =>
                  setExcluded(prev => {
                    const next = new Set(prev)
                    if (next.has(candidate.transactionId)) {
                      next.delete(candidate.transactionId)
                    } else {
                      next.add(candidate.transactionId)
                    }
                    return next
                  })
                }
              />
              {/* 遡及候補は月をまたいで並ぶため年を含めて出す（usability 5-4） */}
              <span className={styles.date}>{formatDateWithYear(candidate.occurredAt)}</span>
              <span className={styles.amount}>{formatMoney(candidate.amount)}</span>
            </label>
          </li>
        ))}
      </ul>
      {apply.error && (
        <div className={ui.error} role="alert">
          {applyErrorMessage(apply.error)}
        </div>
      )}
      {selectedIds.length === 0 && (
        // 3-5: なぜ押せないかを画面上に出す
        <p className={styles.hint}>変更する取引にチェックを入れると、まとめて変更できます。</p>
      )}
      <button
        className={ui.button}
        disabled={selectedIds.length === 0 || apply.isPending}
        onClick={() => apply.mutate()}
      >
        {apply.isPending ? '変更中...' : `選んだ ${selectedIds.length} 件も同じ分類にする`}
      </button>
      <button className={ui.buttonGhost} disabled={apply.isPending} onClick={onDone}>
        この取引だけにする
      </button>
    </>
  )
}
