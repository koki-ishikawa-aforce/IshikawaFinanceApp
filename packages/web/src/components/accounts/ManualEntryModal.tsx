'use client'

/**
 * 別銀行貯蓄口座の手入力モーダル（#406。取り崩しを記録 / 残高を補正）。
 *
 * 送り先は #397 の API（`POST /api/accounts/:id/withdraw` / `PUT /api/accounts/:id/balance`）。
 * 金額の不変条件（1 円以上・上限・残高を超える取り崩しの禁止）はドメインが持ち、ここでは
 * 「送る前に気づける」最低限（未入力・整数でない・0 以下）だけを見る（AccountAddModal と同じ規律）。
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { ErrorState } from '@/components/ui/ErrorState'
import { ApiError, apiMutate, describeRequestFailure } from '@/lib/api-client'
import { UnknownResponseSchema } from '@/lib/api-schemas'
import { formatMoney } from '@/lib/format'
import ui from '@/components/ui/common.module.css'

export type ManualEntryKind = 'withdrawal' | 'correction'

const COPY: Record<
  ManualEntryKind,
  {
    title: string
    label: string
    placeholder: string
    note: string
    invalid: string
    submit: string
  }
> = {
  withdrawal: {
    title: '取り崩しを記録',
    label: '取り崩した金額（円）',
    placeholder: '例: 30000',
    note: '引き出した金額を入力してください。残高からこの金額が引かれます。1 円以上の整数で入力してください（円マーク・カンマは不要）。',
    invalid: '金額は 1 円以上の整数で入力してください（円マーク・カンマ・小数は使えません）',
    submit: '記録する',
  },
  correction: {
    title: '残高を補正',
    label: '実際の残高（円）',
    placeholder: '例: 1740000',
    note: '通帳やアプリに出ている、いまの残高をそのまま入力してください。0 円以上の整数で入力してください（円マーク・カンマは不要）。',
    invalid: '残高は 0 円以上の整数で入力してください（円マーク・カンマ・小数は使えません）',
    submit: '補正する',
  },
}

/** 金額欄の入力値が送れる形か（取り崩しは 1 円以上、補正は 0 円以上） */
function isAmountInputValid(value: string, kind: ManualEntryKind): boolean {
  if (value === '' || !Number.isInteger(Number(value))) return false
  return kind === 'withdrawal' ? Number(value) >= 1 : Number(value) >= 0
}

/**
 * 失敗した理由を、次にとる行動が分かる文言にする。
 * 409 は口座の状態（残高不足・別の更新と重なった）で、やり直し方が入力の直しとは違う。
 * それ以外は共通の伝え方に任せる（通信そのものが成立しなかった失敗は共通文言になる）。
 */
function manualEntryErrorMessage(error: unknown, kind: ManualEntryKind): string {
  const status = error instanceof ApiError ? error.status : null
  if (status === 409) {
    return kind === 'withdrawal'
      ? '残高を超える取り崩しか、ほかの更新と重なりました。画面を開き直して残高を確かめてください。'
      : 'ほかの更新と重なりました。画面を開き直して、もう一度お試しください。'
  }
  if (status === 400) {
    return '入力の内容を登録できませんでした。金額は 10 億円以下の整数で入力してください。'
  }
  if (status === 403 || status === 404) {
    return 'この口座は操作できません。画面を開き直してください。'
  }
  return describeRequestFailure(error, '登録できませんでした。もう一度お試しください。')
}

interface ManualEntryModalProps {
  accountId: string
  kind: ManualEntryKind
  /** いまの残高。取り崩しの結果を送る前に確かめられるようにする */
  currentBalance: number
  onClose: () => void
}

export function ManualEntryModal({
  accountId,
  kind,
  currentBalance,
  onClose,
}: ManualEntryModalProps) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const copy = COPY[kind]

  const mutation = useMutation({
    mutationFn: () => {
      const trimmedMemo = memo.trim()
      const body =
        kind === 'withdrawal'
          ? { amount: Number(amount), ...(trimmedMemo === '' ? {} : { memo: trimmedMemo }) }
          : { balance: Number(amount), ...(trimmedMemo === '' ? {} : { memo: trimmedMemo }) }
      // 口座IDは URL クエリ由来の外部入力。組み立てるパスをずらされないよう必ず符号化する
      const encodedAccountId = encodeURIComponent(accountId)
      return apiMutate(
        kind === 'withdrawal'
          ? `/api/accounts/${encodedAccountId}/withdraw`
          : `/api/accounts/${encodedAccountId}/balance`,
        { method: kind === 'withdrawal' ? 'POST' : 'PUT', body },
        UnknownResponseSchema,
      )
    },
    onSuccess: async () => {
      // 口座詳細（残高 hero・グラフ・履歴）と残高一覧・資産合計がまとめて古くなる
      await queryClient.invalidateQueries({ queryKey: ['balances'] })
      onClose()
    },
  })

  const valid = isAmountInputValid(amount, kind)

  return (
    <Modal title={copy.title} onClose={onClose}>
      <p className={ui.note}>いまの残高: {formatMoney(currentBalance)}</p>

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor="manual-entry-amount">
          {copy.label}
        </label>
        {/* 金額は type="number" を使わない（usability 4-1。スピナー・指数表記・小数を持ち込まない） */}
        <input
          id="manual-entry-amount"
          className={ui.input}
          type="text"
          inputMode="numeric"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder={copy.placeholder}
        />
        <p className={ui.note}>{copy.note}</p>
      </div>

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor="manual-entry-memo">
          メモ（任意）
        </label>
        <input
          id="manual-entry-memo"
          className={ui.input}
          value={memo}
          maxLength={200}
          onChange={e => setMemo(e.target.value)}
          placeholder="例: 旅行費として引き出し"
        />
        <p className={ui.note}>あとから履歴を見返したときの手がかりになります。</p>
      </div>

      {/* 押せない理由を disabled だけで伝えない（usability.md 3-5）。
          1 文字目から出すと入力途中に赤字が出続けるため、何か入っているときだけ出す */}
      {amount !== '' && !valid && <ErrorState announce={false}>{copy.invalid}</ErrorState>}
      {mutation.error && <ErrorState>{manualEntryErrorMessage(mutation.error, kind)}</ErrorState>}
      <button
        className={ui.button}
        disabled={!valid || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '送信中...' : copy.submit}
      </button>
    </Modal>
  )
}
