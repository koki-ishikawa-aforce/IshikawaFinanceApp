'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BANK_NAME_MAX_LENGTH } from '@warimaru/domain'
import { Modal } from '@/components/ui/Modal'
import { ErrorState } from '@/components/ui/ErrorState'
import {
  BrokerageNameFields,
  isBrokerageNameValid,
  normalizeBrokerageName,
} from '@/components/accounts/AccountAddModal'
import { apiMutate } from '@/lib/api-client'
import {
  UnknownResponseSchema,
  type BrokerageNameWire,
  type OwnAccountWire,
} from '@/lib/api-schemas'
import ui from '@/components/ui/common.module.css'

/**
 * 登録済みの口座の名称を変える2つのモーダル（#48）。
 *
 * 名称を持つのは別銀行貯蓄口座（銀行名）と NISA 口座（証券会社名）だけで、三井住友系は固定。
 * 入力欄の作りは登録時（`AccountAddModal`）と同じ部品を使い、登録と編集で見た目・検証をずらさない。
 */
export function BankNameEditModal({
  account,
  onClose,
}: {
  account: Extract<OwnAccountWire, { kind: 'other_savings' }>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [bankName, setBankName] = useState(account.bankName)

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/accounts/${account.common.accountId}/bank-name`,
        { method: 'PUT', body: { bankName: bankName.trim() } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  return (
    <Modal title="銀行名を変更" onClose={onClose}>
      <input
        className={ui.input}
        value={bankName}
        maxLength={BANK_NAME_MAX_LENGTH}
        onChange={e => setBankName(e.target.value)}
      />
      {mutation.error && <ErrorState>{mutation.error.message}</ErrorState>}
      <button
        className={ui.button}
        disabled={bankName.trim() === '' || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '保存中...' : '保存'}
      </button>
    </Modal>
  )
}

export function BrokerageNameEditModal({
  account,
  onClose,
}: {
  account: Extract<OwnAccountWire, { kind: 'nisa' }>
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [brokerageName, setBrokerageName] = useState<BrokerageNameWire>(account.brokerageName)

  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/accounts/${account.common.accountId}/brokerage-name`,
        { method: 'PUT', body: { brokerageName: normalizeBrokerageName(brokerageName) } },
        UnknownResponseSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      onClose()
    },
  })

  return (
    <Modal title="証券会社名を変更" onClose={onClose}>
      <BrokerageNameFields value={brokerageName} onChange={setBrokerageName} />
      {mutation.error && <ErrorState>{mutation.error.message}</ErrorState>}
      <button
        className={ui.button}
        disabled={!isBrokerageNameValid(brokerageName) || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '保存中...' : '保存'}
      </button>
    </Modal>
  )
}
