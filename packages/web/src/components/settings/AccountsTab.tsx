'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '@/components/ui/EmptyState'
import { AccountAddModal } from '@/components/accounts/AccountAddModal'
import {
  BankNameEditModal,
  BrokerageNameEditModal,
} from '@/components/accounts/AccountNameEditModal'
import { apiFetch, describeRequestFailure } from '@/lib/api-client'
import { OwnAccountListWireSchema, type OwnAccountWire } from '@/lib/api-schemas'
import { ACCOUNT_KIND_LABELS, ACCOUNT_KIND_ORDER, brokerageNameLabel } from '@/lib/labels'
import { formatMoney } from '@/lib/format'
import { LuPlus } from '@/components/ui/icons'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import listStyles from './settingsList.module.css'
import styles from './AccountsTab.module.css'

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
    <li className={listStyles.row}>
      <span className={listStyles.name}>{ACCOUNT_KIND_LABELS[account.kind]}</span>
      <span className={listStyles.rowActions}>
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
      {/* 空状態は一覧を取れたときだけ出す。失敗時にも出すと「取れなかった」が「0 件」に見える */}
      {accountsQuery.isSuccess && items.length === 0 && (
        <EmptyState>登録済みの口座はありません。</EmptyState>
      )}
      {items.length > 0 && (
        <ul className={listStyles.list}>
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
      )}
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
