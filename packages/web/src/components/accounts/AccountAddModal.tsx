'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { ErrorState } from '@/components/ui/ErrorState'
import { apiMutate } from '@/lib/api-client'
import {
  UnknownResponseSchema,
  type BrokerageNameWire,
  type OwnAccountWire,
} from '@/lib/api-schemas'
import { ACCOUNT_KIND_LABELS } from '@/lib/labels'
import ui from '@/components/ui/common.module.css'
import styles from './AccountAddModal.module.css'

/**
 * 口座の登録モーダル（口座種別 4 種、#395）。
 *
 * 本番で口座を作れる経路はこのモーダルだけで、設定 > 口座（あとから増やす）と
 * はじめての設定 Section B（初期残高を登録する前に作る）の両方から開く。入力項目と
 * 送る内容が画面ごとにずれると、片方から作った口座だけ初期残高が入っていない、といった
 * 食い違いが起きるため 1 か所に置く。
 *
 * 金額の不変条件（0 円以上・上限）はドメインが持つ。ここで課すのは「送る前に気づける」
 * 最低限（未入力・整数でない・負）だけで、上限などの判定は再実装しない。
 */
export type AccountKindWire = OwnAccountWire['kind']

/** 証券会社の選択欄（NISA 口座の登録と、設定画面での証券会社名の変更が共有する） */
export function BrokerageNameFields({
  value,
  onChange,
}: {
  value: BrokerageNameWire
  onChange: (next: BrokerageNameWire) => void
}) {
  return (
    <>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor="account-brokerage-name">
          証券会社
        </label>
        <select
          id="account-brokerage-name"
          className={ui.select}
          value={value.kind}
          onChange={e => {
            const kind = e.target.value as BrokerageNameWire['kind']
            onChange(kind === 'other' ? { kind, customName: '' } : { kind })
          }}
        >
          <option value="sbi">SBI証券</option>
          <option value="rakuten">楽天証券</option>
          <option value="other">その他</option>
        </select>
      </div>
      {value.kind === 'other' && (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor="account-brokerage-custom-name">
            証券会社名
          </label>
          <input
            id="account-brokerage-custom-name"
            className={ui.input}
            value={value.customName}
            maxLength={50}
            onChange={e => onChange({ kind: 'other', customName: e.target.value })}
            placeholder="例: マネックス証券"
          />
        </div>
      )}
    </>
  )
}

export function isBrokerageNameValid(value: BrokerageNameWire): boolean {
  return value.kind !== 'other' || value.customName.trim() !== ''
}

export function normalizeBrokerageName(value: BrokerageNameWire): BrokerageNameWire {
  return value.kind === 'other' ? { kind: 'other', customName: value.customName.trim() } : value
}

/** 金額欄の入力値が送れる形か（0 円以上の整数） */
function isAmountInputValid(value: string): boolean {
  return value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0
}

interface AccountAddModalProps {
  kind: AccountKindWire
  onClose: () => void
}

export function AccountAddModal({ kind, onClose }: AccountAddModalProps) {
  const queryClient = useQueryClient()
  const [initialAmount, setInitialAmount] = useState('')
  const [bankName, setBankName] = useState('')
  const [brokerageName, setBrokerageName] = useState<BrokerageNameWire>({ kind: 'sbi' })

  const body = (): unknown => {
    switch (kind) {
      case 'smbc_bank':
        return { kind, initialBalance: Number(initialAmount) }
      case 'mitsui_sumitomo_card':
        return { kind }
      case 'other_savings':
        return { kind, bankName: bankName.trim(), initialBalance: Number(initialAmount) }
      case 'nisa':
        return {
          kind,
          brokerageName: normalizeBrokerageName(brokerageName),
          initialAccumulated: Number(initialAmount),
        }
    }
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate('/api/accounts', { method: 'POST', body: body() }, UnknownResponseSchema),
    onSuccess: async () => {
      // 口座一覧（設定）と初期残高登録参照（はじめての設定）の両方が同じ問い合わせを見る
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  const valid = ((): boolean => {
    switch (kind) {
      case 'smbc_bank':
        return isAmountInputValid(initialAmount)
      case 'mitsui_sumitomo_card':
        return true
      case 'other_savings':
        return bankName.trim() !== '' && isAmountInputValid(initialAmount)
      case 'nisa':
        return isBrokerageNameValid(brokerageName) && isAmountInputValid(initialAmount)
    }
  })()

  return (
    <Modal title={`${ACCOUNT_KIND_LABELS[kind]}を追加`} onClose={onClose}>
      {kind === 'smbc_bank' && (
        <p className={styles.note}>
          三井住友銀行の普通預金口座です。登録すると、以降の入出金は通知メールの取込で自動的に反映されます。
        </p>
      )}
      {kind === 'mitsui_sumitomo_card' && (
        <p className={styles.note}>
          カード利用の通知メールから未払金を積み上げる先の口座です。未払金は取込で自動的に記録されるので、入力する項目はありません。
        </p>
      )}

      {kind === 'other_savings' && (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor="account-bank-name">
            銀行名
          </label>
          <input
            id="account-bank-name"
            className={ui.input}
            value={bankName}
            maxLength={50}
            onChange={e => setBankName(e.target.value)}
            placeholder="例: 楽天銀行"
          />
        </div>
      )}

      {kind === 'nisa' && <BrokerageNameFields value={brokerageName} onChange={setBrokerageName} />}

      {kind !== 'mitsui_sumitomo_card' && (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor="account-initial-amount">
            {kind === 'nisa'
              ? '積立累計（円、初期累計として登録）'
              : '現在の残高（円、初期残高として登録）'}
          </label>
          <input
            id="account-initial-amount"
            className={ui.input}
            type="number"
            value={initialAmount}
            onChange={e => setInitialAmount(e.target.value)}
            placeholder={kind === 'nisa' ? '例: 200000' : '例: 500000'}
          />
        </div>
      )}

      {mutation.error && <ErrorState>{mutation.error.message}</ErrorState>}
      <button
        className={ui.button}
        disabled={!valid || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '登録中...' : '登録'}
      </button>
    </Modal>
  )
}
