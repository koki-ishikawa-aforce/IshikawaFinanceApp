'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  AccountAddModal,
  BrokerageNameFields,
  isBrokerageNameValid,
  normalizeBrokerageName,
} from '@/components/accounts/AccountAddModal'
import { apiFetch, apiMutate, describeRequestFailure } from '@/lib/api-client'
import {
  OwnAccountListWireSchema,
  UnknownResponseSchema,
  type BrokerageNameWire,
  type OwnAccountWire,
} from '@/lib/api-schemas'
import { ACCOUNT_KIND_LABELS, ACCOUNT_KIND_ORDER, brokerageNameLabel } from '@/lib/labels'
import { formatMoney } from '@/lib/format'
import { LuPlus } from '@/components/ui/icons'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './AccountsTab.module.css'

function BankNameEditModal({
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
        maxLength={50}
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

function BrokerageNameEditModal({
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

function AccountRow({ account, onEdit }: { account: OwnAccountWire; onEdit: (() => void) | null }) {
  const detail =
    account.kind === 'smbc_bank'
      ? formatMoney(account.balance.currentBalance)
      : account.kind === 'other_savings'
        ? `${account.bankName} / ${formatMoney(account.balance.currentBalance)}`
        : account.kind === 'nisa'
          ? `${brokerageNameLabel(account.brokerageName)} / ${formatMoney(account.contribution.currentAccumulated)}`
          : null
  return (
    <li className={styles.masterRow}>
      <span className={styles.masterName}>{ACCOUNT_KIND_LABELS[account.kind]}</span>
      <span className={styles.rowActions}>
        {detail !== null && <span className={styles.accountDetail}>{detail}</span>}
        {onEdit !== null ? (
          <button
            className={ui.textButton}
            aria-label={`${ACCOUNT_KIND_LABELS[account.kind]}を編集`}
            onClick={onEdit}
          >
            編集
          </button>
        ) : (
          <span className={ui.badge}>固定</span>
        )}
      </span>
    </li>
  )
}

/**
 * 設定 > 口座タブ（#48 / 登録は #395 で AccountAddModal に集約）。
 *
 * 未登録の口座種別にだけ追加ボタンを出す。このボタンは口座を持たない人が先へ進む唯一の入り口で、
 * 消えても本人以外は気づけないため、出し分けは `__tests__/AccountsTab.test.tsx` で固定する（#507）。
 */
export function AccountsTab() {
  const [adding, setAdding] = useState<OwnAccountWire['kind'] | null>(null)
  const [editing, setEditing] = useState<OwnAccountWire | null>(null)

  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch('/api/accounts', OwnAccountListWireSchema),
  })

  const items = accountsQuery.data?.items ?? []
  /**
   * 未登録の口座種別（同一ユーザー × 口座種別は 1 件のため、登録済みの種別は追加できない）。
   * 一覧を取得できるまでは出さない。読み込み中の空配列を「未登録」と読むと、登録済みの種別にも
   * 追加ボタンが一瞬出て、押した人が重複登録（409）に当たる。
   */
  const registrableKinds = accountsQuery.isSuccess
    ? ACCOUNT_KIND_ORDER.filter(kind => !items.some(a => a.kind === kind))
    : []

  return (
    <div className={ui.card}>
      <span className={ui.sectionTitle}>口座管理</span>
      <p className={ui.note}>
        自分が所有する口座の一覧です。口座種別ごとに 1 つずつ登録できます。別銀行貯蓄口座の銀行名と
        NISA 口座の証券会社名は登録後も編集できます（三井住友系の名称は固定です）。
      </p>
      {accountsQuery.isLoading && <LoadingState />}
      {accountsQuery.error && (
        <ErrorState>
          {describeRequestFailure(accountsQuery.error, '口座の取得に失敗しました')}
        </ErrorState>
      )}
      {!accountsQuery.isLoading && items.length === 0 && (
        <EmptyState>登録済みの口座はありません。</EmptyState>
      )}
      <ul className={styles.masterList}>
        {items.map(account => (
          <AccountRow
            key={account.common.accountId}
            account={account}
            onEdit={
              account.kind === 'other_savings' || account.kind === 'nisa'
                ? () => setEditing(account)
                : null
            }
          />
        ))}
      </ul>
      {registrableKinds.length > 0 && (
        <div className={styles.addRow}>
          {registrableKinds.map(kind => (
            <button
              key={kind}
              className={`${ui.button} ${ui.iconLabel}`}
              aria-label={`${ACCOUNT_KIND_LABELS[kind]}を追加`}
              onClick={() => setAdding(kind)}
            >
              <LuPlus aria-hidden="true" className={ui.iconSm} />
              {ACCOUNT_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      )}

      {adding !== null && <AccountAddModal kind={adding} onClose={() => setAdding(null)} />}
      {editing?.kind === 'other_savings' && (
        <BankNameEditModal account={editing} onClose={() => setEditing(null)} />
      )}
      {editing?.kind === 'nisa' && (
        <BrokerageNameEditModal account={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
