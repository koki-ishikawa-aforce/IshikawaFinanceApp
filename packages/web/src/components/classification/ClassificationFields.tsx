'use client'

import { useId } from 'react'
import { EXPENSE_CLASS_LABELS } from '@/lib/labels'
import { describeRequestFailure } from '@/lib/api-client'
import type { ExpenseClassWire } from '@/lib/api-schemas'
import type { MastersState } from './useMasters'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'

/** 3 軸（カテゴリ / 費用区分 / 経費種別）の入力値 */
export interface ClassificationInput {
  categoryId: string
  expenseClass: ExpenseClassWire
  expenseTypeId?: string
}

/** `PUT /api/transactions/:id/classify` / `POST /api/transactions` の分類ボディ */
export function classificationBody(input: ClassificationInput): Record<string, unknown> {
  return {
    categoryId: input.categoryId,
    expenseClass: input.expenseClass,
    ...(input.expenseClass === 'business_expense' && input.expenseTypeId !== undefined
      ? { expenseTypeId: input.expenseTypeId }
      : {}),
  }
}

/** 送信可能か。経費(会社) は経費種別まで選ばれて初めて成立する（domain の不変条件と対） */
export function classificationValid(input: ClassificationInput): boolean {
  if (input.categoryId === '') return false
  if (input.expenseClass === 'business_expense' && (input.expenseTypeId ?? '') === '') return false
  return true
}

interface ClassificationFieldsProps {
  value: ClassificationInput
  onChange: (value: ClassificationInput) => void
  masters: MastersState
}

/**
 * 3 軸分類の入力フォーム。取引の編集モーダルと一括分類セッションで共有する
 * （同じ入力を 2 か所で書き起こすと選択肢や必須条件がずれるため）。
 *
 * `useId` で label と input を関連付ける（usability 8-3）。同一画面に複数個
 * 並んでも id が衝突しない。
 *
 * マスタが未取得のうちは空のセレクトを見せない（同 7-2）。取得に失敗したら
 * 選ぶものが無いままになるため、再試行手段を出す（同 1-3）。
 */
export function ClassificationFields({ value, onChange, masters }: ClassificationFieldsProps) {
  const idPrefix = useId()
  const { categories, expenseTypes } = masters
  const categoryId = `${idPrefix}-category`
  const expenseClassId = `${idPrefix}-expense-class`
  const expenseTypeId = `${idPrefix}-expense-type`

  if (masters.isPending) {
    return <LoadingState>分類の選択肢を読み込み中...</LoadingState>
  }

  if (masters.isError) {
    return (
      <ErrorState onRetry={() => void masters.refetch()} isRetrying={masters.isFetching}>
        {describeRequestFailure(
          masters.error,
          'カテゴリ・経費種別を読み込めませんでした。分類にはこの選択肢が必要です。',
        )}
      </ErrorState>
    )
  }

  return (
    <>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={categoryId}>
          カテゴリ
        </label>
        <select
          id={categoryId}
          className={ui.select}
          value={value.categoryId}
          onChange={e => onChange({ ...value, categoryId: e.target.value })}
        >
          <option value="">選択してください</option>
          {categories.map(category => (
            <option key={category.categoryId} value={category.categoryId}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={expenseClassId}>
          費用区分
        </label>
        <select
          id={expenseClassId}
          className={ui.select}
          value={value.expenseClass}
          onChange={e => onChange({ ...value, expenseClass: e.target.value as ExpenseClassWire })}
        >
          {Object.entries(EXPENSE_CLASS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {value.expenseClass === 'business_expense' && (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={expenseTypeId}>
            経費種別
          </label>
          <select
            id={expenseTypeId}
            className={ui.select}
            value={value.expenseTypeId ?? ''}
            onChange={e =>
              onChange({
                ...value,
                expenseTypeId: e.target.value === '' ? undefined : e.target.value,
              })
            }
          >
            <option value="">選択してください</option>
            {expenseTypes.map(expenseType => (
              <option key={expenseType.expenseTypeId} value={expenseType.expenseTypeId}>
                {expenseType.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  )
}
