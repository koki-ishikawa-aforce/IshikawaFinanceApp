'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { apiMutate } from '@/lib/api-client'
import {
  BulkClassificationSessionWireSchema,
  UnknownResponseSchema,
  type BulkClassificationTargetWire,
  type InProgressBulkClassificationSessionWire,
} from '@/lib/api-schemas'
import { unclassifiedReasonLabel } from '@/lib/labels'
import {
  ClassificationFields,
  classificationBody,
  classificationValid,
  type ClassificationInput,
} from './ClassificationFields'
import { useMasters } from './useMasters'
import ui from '@/components/ui/common.module.css'
import styles from './BulkClassificationModal.module.css'

interface MerchantGroup {
  merchantName: string
  targets: BulkClassificationTargetWire[]
}

/**
 * 同一加盟店の未分類取引を 1 グループにまとめる（08b N-1: 同一加盟店の複数取引への
 * ルールは 1 件に集約される）。1 グループ = 1 回の入力 = 1 件の学習ルール。
 */
export function groupTargetsByMerchant(targets: BulkClassificationTargetWire[]): MerchantGroup[] {
  const groups: MerchantGroup[] = []
  for (const target of targets) {
    const found = groups.find(group => group.merchantName === target.merchantName)
    if (found === undefined) {
      groups.push({ merchantName: target.merchantName, targets: [target] })
    } else {
      found.targets.push(target)
    }
  }
  return groups
}

function initialInput(group: MerchantGroup): ClassificationInput {
  // 4-6: 既定値を埋める。未分類取引の既定費用区分（本人の個人費）を初期選択にする
  return { categoryId: '', expenseClass: group.targets[0]?.defaultExpenseClass ?? 'household' }
}

interface BulkClassificationModalProps {
  session: InProgressBulkClassificationSessionWire
  /**
   * 閉じたときの後始末。`reason` は呼び出し側がバナー表示を切り替えるために使う
   * - `completed` / `aborted`: セッションは終端状態になった
   * - `left`: 進行中のまま離脱した（再開できる）
   */
  onClose: (reason: 'completed' | 'aborted' | 'left') => void
}

/**
 * 一括分類セッションのモーダル（spec §7.1「未分類アラート + 一括分類ボタン」）。
 *
 * 加盟店ごとに 3 軸を入力して順に確定し、最後にセッションを完了させる。
 * 分類そのものは既存の `PUT /api/transactions/:id/classify` を使う（学習ルールの
 * 登録はサーバー側の手動修正反映に一元化されており、web で再実装しない）。
 */
export function BulkClassificationModal({ session, onClose }: BulkClassificationModalProps) {
  const queryClient = useQueryClient()
  const { categories, expenseTypes } = useMasters()
  const groups = groupTargetsByMerchant(session.common.targets)
  const sessionId = session.common.bulkClassificationSessionId

  const [index, setIndex] = useState(0)
  const [input, setInput] = useState<ClassificationInput>(() =>
    groups[0] === undefined
      ? { categoryId: '', expenseClass: 'household' }
      : initialInput(groups[0]),
  )
  const [classifiedCount, setClassifiedCount] = useState(0)
  const [completed, setCompleted] = useState<{ processedCount: number } | null>(null)

  const group = groups[index]

  const complete = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/classification/bulk-sessions/${sessionId}/complete`,
        { method: 'POST' },
        BulkClassificationSessionWireSchema,
      ),
    onSuccess: async result => {
      setCompleted({ processedCount: result.kind === 'completed' ? result.processedCount : 0 })
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
      await queryClient.invalidateQueries({ queryKey: ['classification', 'bulk-session'] })
    },
  })

  /** 次の加盟店へ進む。最後まで来ていたらセッションを完了させる */
  const advance = (from: number) => {
    const next = from + 1
    const nextGroup = groups[next]
    if (nextGroup === undefined) {
      complete.mutate()
      return
    }
    setIndex(next)
    setInput(initialInput(nextGroup))
  }

  const classify = useMutation({
    mutationFn: async (target: MerchantGroup) => {
      // 同一加盟店の取引を 1 件ずつ確定する（1 件目で学習ルールが登録され、
      // 残りも同じ 3 軸で確定される）。途中で失敗した場合は成功分がそのまま残り、
      // 再実行すれば残りが確定する（分類の再実行は冪等）
      for (const item of target.targets) {
        await apiMutate(
          `/api/transactions/${item.transactionId}/classify`,
          { method: 'PUT', body: classificationBody(input) },
          UnknownResponseSchema,
        )
      }
      return target.targets.length
    },
    onSuccess: async count => {
      setClassifiedCount(prev => prev + count)
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
      advance(index)
    },
  })

  const abort = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/classification/bulk-sessions/${sessionId}/abort`,
        { method: 'POST' },
        BulkClassificationSessionWireSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
      await queryClient.invalidateQueries({ queryKey: ['classification', 'bulk-session'] })
      onClose('aborted')
    },
  })

  const pending = classify.isPending || complete.isPending || abort.isPending

  if (completed !== null) {
    return (
      <Modal title="まとめて分類" onClose={() => onClose('completed')}>
        <div className={styles.done} role="status">
          {completed.processedCount} 件を分類しました。同じ店舗の取引は次回から自動で分類されます。
        </div>
        <button className={ui.button} onClick={() => onClose('completed')}>
          閉じる
        </button>
      </Modal>
    )
  }

  return (
    <Modal title="まとめて分類" onClose={() => onClose('left')}>
      {group === undefined ? (
        <>
          <EmptyState announce={false}>
            分類する取引が残っていません。この分類をおわりにしてください。
          </EmptyState>
          {complete.error && (
            <div className={ui.error} role="alert">
              分類のおわりに失敗しました。通信状態を確かめて、もう一度お試しください。
            </div>
          )}
          <button
            className={ui.button}
            disabled={complete.isPending}
            onClick={() => complete.mutate()}
          >
            {complete.isPending ? '終了中...' : 'まとめて分類をおわる'}
          </button>
        </>
      ) : (
        <>
          <p className={styles.progress} role="status">
            {index + 1} / {groups.length} 店舗（分類済み {classifiedCount} 件）
          </p>
          <div className={styles.target}>
            <span className={styles.merchant}>{group.merchantName}</span>
            <span className={styles.targetMeta}>
              <span className={ui.badge}>{group.targets.length} 件</span>
              <span className={styles.reason}>
                {unclassifiedReasonLabel(group.targets[0]?.reason ?? 'merchant_rule_unlearned')}
              </span>
            </span>
          </div>

          <ClassificationFields
            value={input}
            onChange={setInput}
            categories={categories}
            expenseTypes={expenseTypes}
          />

          {classify.error && (
            <div className={ui.error} role="alert">
              分類の保存に失敗しました。通信状態を確かめて、もう一度「この店舗を分類」を押してください。
            </div>
          )}
          {complete.error && (
            <div className={ui.error} role="alert">
              分類のおわりに失敗しました。通信状態を確かめて、もう一度お試しください。
            </div>
          )}
          {!classificationValid(input) && (
            // 3-5: なぜ押せないかを画面上に出す
            <p className={styles.hint}>
              {input.categoryId === ''
                ? 'カテゴリを選ぶと分類できます'
                : '経費種別を選ぶと分類できます'}
            </p>
          )}
          <button
            className={ui.button}
            disabled={!classificationValid(input) || pending}
            onClick={() => classify.mutate(group)}
          >
            {classify.isPending
              ? '分類中...'
              : complete.isPending
                ? '終了中...'
                : `この店舗の ${group.targets.length} 件を分類`}
          </button>
          <button className={ui.buttonGhost} disabled={pending} onClick={() => advance(index)}>
            この店舗はとばす
          </button>
        </>
      )}

      {abort.error && (
        <div className={ui.error} role="alert">
          分類の取りやめに失敗しました。通信状態を確かめて、もう一度お試しください。
        </div>
      )}
      <div className={styles.footer}>
        <button className={ui.buttonGhost} disabled={pending} onClick={() => onClose('left')}>
          あとで続ける
        </button>
        <button className={ui.buttonDanger} disabled={pending} onClick={() => abort.mutate()}>
          {abort.isPending ? '取りやめ中...' : 'まとめて分類をやめる'}
        </button>
      </div>
      <p className={styles.hint}>
        「あとで続ける」はここまでの分類を残したまま中断します。「やめる」を選ぶと、残りの取引は未分類のままこの一括分類を終了します（分類済みの取引はそのまま残ります）。
      </p>
    </Modal>
  )
}
