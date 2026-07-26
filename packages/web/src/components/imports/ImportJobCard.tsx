/**
 * 明細取込ジョブ（CSV / PDF）の状態カード。
 * 進行状態・件数サマリ・失敗理由を1か所で表示する。
 */
'use client'

import type { ImportJobWire } from '@/lib/api-schemas'
import { describeImportFailure } from '@/lib/import-upload'
import ui from '@/components/ui/common.module.css'
import styles from './ImportJobCard.module.css'

const JOB_LABELS: Record<ImportJobWire['kind'], string> = {
  upload_accepted: '受付済み',
  pdf_converting: 'PDF変換中',
  format_validating: '形式検証中',
  importing: '取込中',
  completed: '取込完了',
  failed: '失敗',
}

export interface ImportJobCardProps {
  job: ImportJobWire
}

export function ImportJobCard({ job }: ImportJobCardProps) {
  const failed = job.kind === 'failed'
  return (
    // 取込の進行・結果は操作後に差し替わるため支援技術へ通知する（usability §8-4）
    <section className={ui.card} aria-labelledby="import-job-title" aria-live="polite">
      <div className={ui.rowBetween}>
        <h2 id="import-job-title" className={ui.sectionTitle}>
          取込ジョブ
        </h2>
        <span className={failed ? styles.failedBadge : ui.badgeAccent}>{JOB_LABELS[job.kind]}</span>
      </div>
      {job.summary && (
        <ul className={styles.summaryList}>
          <li>新規候補: {job.summary.newCount} 件</li>
          <li>重複除外: {job.summary.duplicateExcludedCount} 件</li>
        </ul>
      )}
      {job.failureReason && (
        <div className={ui.error}>{describeImportFailure(job.failureReason)}</div>
      )}
    </section>
  )
}
