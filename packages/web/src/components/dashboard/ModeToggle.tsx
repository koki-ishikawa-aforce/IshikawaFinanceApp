'use client'

import type { DashboardMode } from '@warimaru/domain'
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/SegmentedControl'

interface ModeToggleProps {
  mode: DashboardMode
  onModeChange: (mode: DashboardMode) => void
}

const MODE_OPTIONS: readonly SegmentedControlOption<DashboardMode>[] = [
  { value: 'household', label: '世帯' },
  { value: 'personal', label: '個人' },
]

/**
 * ダッシュボードの集計範囲(世帯 / 個人)の切り替え。
 *
 * 見た目と挙動は共通部品 `SegmentedControl` に委ね、ここは選択肢の定義だけを持つ
 * (`docs/design/usability.md` §6-9。独自のタブ風ボタンは採用しない)。共通部品に寄せることで、
 * 選択中がラジオの `checked` として支援技術にも伝わり、押せる範囲と隣接間隔の下限も満たす
 */
export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <SegmentedControl
      label="集計の範囲"
      options={MODE_OPTIONS}
      value={mode}
      onChange={onModeChange}
    />
  )
}
