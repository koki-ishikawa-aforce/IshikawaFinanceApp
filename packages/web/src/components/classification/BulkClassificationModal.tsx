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
  type UnclassifiedReasonWire,
} from '@/lib/api-schemas'
import { unclassifiedReasonLabel } from '@/lib/labels'
import {
  ClassificationFields,
  classificationBody,
  classificationValid,
  type ClassificationInput,
} from './ClassificationFields'
import { useMasters } from './useMasters'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './BulkClassificationModal.module.css'

interface MerchantGroup {
  merchantName: string
  /** グループの代表。加盟店名・未分類理由・既定費用区分はこの取引から採る */
  head: BulkClassificationTargetWire
  targets: BulkClassificationTargetWire[]
}

/**
 * 加盟店学習ルールが作られる未分類理由か（08b X-1 / M-1）。
 * Amazon 商品キー由来・学習無効化の加盟店は分類しても加盟店ルールにならないため、
 * 「次回から自動で分類される」とは言えない。
 */
function learnsMerchantRule(reason: UnclassifiedReasonWire): boolean {
  return reason === 'merchant_rule_unlearned'
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
      groups.push({ merchantName: target.merchantName, head: target, targets: [target] })
    } else {
      found.targets.push(target)
    }
  }
  return groups
}

function initialInput(group: MerchantGroup): ClassificationInput {
  // 4-6: 既定値を埋める。未分類取引の既定費用区分（本人の個人費）を初期選択にする
  return { categoryId: '', expenseClass: group.head.defaultExpenseClass }
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
 *
 * 状態の呼び名は 08b のライフサイクル（進行中 / 完了 / 中断）に 1 語ずつ対応させる:
 * 完了 =「おえる」、中断 =「やめる」、離脱 =「あとで続ける」。
 */
export function BulkClassificationModal({ session, onClose }: BulkClassificationModalProps) {
  const queryClient = useQueryClient()
  const masters = useMasters()
  const groups = groupTargetsByMerchant(session.common.targets)
  const sessionId = session.common.bulkClassificationSessionId

  const [index, setIndex] = useState(0)
  const [input, setInput] = useState<ClassificationInput>(() =>
    groups[0] === undefined
      ? { categoryId: '', expenseClass: 'personal_darling' }
      : initialInput(groups[0]),
  )
  const [classifiedCount, setClassifiedCount] = useState(0)
  const [learnedMerchantCount, setLearnedMerchantCount] = useState(0)
  const [completed, setCompleted] = useState<{ processedCount: number } | null>(null)
  const [confirmingAbort, setConfirmingAbort] = useState(false)

  const group = groups[index]

  const complete = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/classification/bulk-sessions/${sessionId}/complete`,
        { method: 'POST' },
        BulkClassificationSessionWireSchema,
      ),
    onSuccess: async result => {
      // 処理件数はサーバーが対象取引の実状態から数え直した値を使う
      // （とばした店舗があるぶん、この画面で数えた件数とは一致しない）
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
      return target
    },
    onSuccess: async classified => {
      setClassifiedCount(prev => prev + classified.targets.length)
      if (learnsMerchantRule(classified.head.reason)) {
        setLearnedMerchantCount(prev => prev + 1)
      }
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
  const remainingCount = groups.slice(index).reduce((sum, item) => sum + item.targets.length, 0)

  if (completed !== null) {
    return (
      <Modal title="まとめて分類" onClose={() => onClose('completed')}>
        <div className={styles.done} role="status">
          {completed.processedCount} 件を分類しました。
          {learnedMerchantCount > 0 && '同じ店舗の取引は次回から自動で分類されます。'}
        </div>
        <button className={ui.button} onClick={() => onClose('completed')}>
          閉じる
        </button>
      </Modal>
    )
  }

  // 中断は終端状態でやり直せないため、押した内容と影響を示して確認する（usability 3-1 / 3-2）
  if (confirmingAbort) {
    return (
      <Modal title="まとめて分類をやめる" onClose={() => setConfirmingAbort(false)}>
        <p className={styles.lead}>
          まだ分類していない {remainingCount}{' '}
          件は未分類のままになり、このまとめて分類は再開できなくなります。分類済みの取引はそのまま残ります。
        </p>
        {abort.error && (
          <ErrorState>
            取りやめられませんでした。通信状態を確かめて、もう一度お試しください。
          </ErrorState>
        )}
        <button
          className={ui.buttonDanger}
          disabled={abort.isPending}
          onClick={() => abort.mutate()}
        >
          {abort.isPending ? 'やめています...' : 'やめる'}
        </button>
        <button
          className={ui.buttonGhost}
          disabled={abort.isPending}
          onClick={() => setConfirmingAbort(false)}
        >
          分類に戻る
        </button>
      </Modal>
    )
  }

  return (
    <Modal title="まとめて分類" onClose={() => onClose('left')}>
      {group === undefined ? (
        <>
          <EmptyState announce={false}>
            分類する取引が残っていません。このまとめて分類をおえてください。
          </EmptyState>
          {complete.error && (
            <ErrorState>
              おえられませんでした。通信状態を確かめて、もう一度お試しください。
            </ErrorState>
          )}
          <button
            className={ui.button}
            disabled={complete.isPending}
            onClick={() => complete.mutate()}
          >
            {complete.isPending ? 'おわり中...' : 'まとめて分類をおえる'}
          </button>
        </>
      ) : (
        <>
          {/* 加盟店が切り替わったことを進捗・店名・理由まとめて読み上げる（usability 8-4） */}
          <div role="status">
            <p className={styles.progress}>
              {index + 1} / {groups.length} 店舗（分類済み {classifiedCount} 件）
            </p>
            <div className={`${ui.card} ${styles.target}`}>
              <span className={styles.merchant}>{group.merchantName}</span>
              <span className={styles.targetMeta}>
                <span className={ui.badge}>{group.targets.length} 件</span>
                <span className={styles.reason}>{unclassifiedReasonLabel(group.head.reason)}</span>
              </span>
            </div>
          </div>

          <ClassificationFields value={input} onChange={setInput} masters={masters} />

          {classify.error && (
            <ErrorState>
              分類の保存に失敗しました。通信状態を確かめて、もう一度「この店舗の{' '}
              {group.targets.length} 件を分類」を押してください。
            </ErrorState>
          )}
          {complete.error && (
            <ErrorState>
              おえられませんでした。通信状態を確かめて、「この店舗はとばす」でもう一度お試しください。
            </ErrorState>
          )}
          {!classificationValid(input) && !masters.isPending && !masters.isError && (
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
                ? 'おわり中...'
                : `この店舗の ${group.targets.length} 件を分類`}
          </button>
          <button className={ui.buttonGhost} disabled={pending} onClick={() => advance(index)}>
            この店舗はとばす
          </button>
        </>
      )}

      <div className={styles.footer}>
        <p className={styles.hint}>
          「あとで続ける」はここまでの分類を残したまま中断し、取引一覧から続きを再開できます。「やめる」を選ぶと、残りの取引は未分類のままこのまとめて分類を打ち切ります（分類済みの取引はそのまま残ります）。
        </p>
        <button className={ui.buttonGhost} disabled={pending} onClick={() => onClose('left')}>
          あとで続ける
        </button>
        <button
          className={ui.buttonDanger}
          disabled={pending}
          onClick={() => setConfirmingAbort(true)}
        >
          まとめて分類をやめる
        </button>
      </div>
    </Modal>
  )
}
