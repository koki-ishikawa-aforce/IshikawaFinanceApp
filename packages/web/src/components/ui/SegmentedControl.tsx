'use client'

import { useId } from 'react'
import ui from './common.module.css'
import styles from './SegmentedControl.module.css'

export interface SegmentedControlOption<T extends string> {
  value: T
  /** 画面に出す名前。支援技術にもこの文字列が選択肢の名前として伝わる */
  label: string
}

interface SegmentedControlProps<T extends string> {
  /** 選択肢のまとまりに付ける名前(「ファイル種別」など)。グループ名として支援技術にも伝わる */
  label: string
  /** 2〜3 個を想定(`docs/design/usability.md` §4-7)。4 個以上ならセレクトのままにする */
  options: readonly SegmentedControlOption<T>[]
  value: T
  onChange: (value: T) => void
}

/**
 * 2〜3 択を横に並べて 1 タップで切り替える共通部品(`docs/design/usability.md` §4-7 / §6-9)。
 *
 * - 中身はラジオボタン。選ばれているかどうかは見た目だけでなく仕組み(`checked`)としても
 *   伝わり、左右キーでの移動もブラウザ既定の挙動に任せられる(同 §8-1・§8-2)
 * - ラジオは透明にして選択肢いっぱいに広げる。押せる範囲を見た目の枠と一致させ、
 *   タップターゲットの下限(同 §4-3)をラジオそのものの大きさとして満たすため
 * - 選択中は白い面 + 枠 + 影で浮かせる。塗り色を反転させる案は文字とのコントラストが
 *   両テーマで 4.5:1 に届かないため採らない(同 §8-6)
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const id = useId()
  const labelId = `${id}-label`

  return (
    <div className={ui.field}>
      <span id={labelId} className={ui.fieldLabel}>
        {label}
      </span>
      <div className={styles.group} role="radiogroup" aria-labelledby={labelId}>
        {options.map(option => (
          <label key={option.value} className={styles.option}>
            <input
              className={styles.input}
              type="radio"
              name={id}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span className={styles.optionLabel}>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
