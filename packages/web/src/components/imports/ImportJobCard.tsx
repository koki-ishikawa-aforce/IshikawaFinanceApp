/**
 * 明細取込ジョブ（CSV / PDF）の状態カード。
 * 進行状態・件数サマリ・失敗理由を1か所で表示する。
 */
'use client'

import type { ImportJobWire } from '@/lib/api-schemas'
import { describeImportFailure } from '@/lib/import-upload'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './ImportJobCard.module.css'

const JOB_LABELS: Record<ImportJobWire['kind'], string> = {
  upload_accepted: '受付済み',
  pdf_converting: 'PDF変換中',
  // ラベルはユビキタス言語（08a「フォーマット検証中ジョブ」）に合わせる
  format_validating: 'フォーマット検証中',
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
    <section className={ui.card} aria-labelledby="import-job-title">
      <div className={ui.rowBetween}>
        <h2 id="import-job-title" className={ui.sectionTitle}>
          取込ジョブ
        </h2>
        <span className={failed ? ui.badgeError : ui.badgeAccent}>{JOB_LABELS[job.kind]}</span>
      </div>
      {job.summary && (
        // AT-302 手順1: 「新規 N 件 / 自動分類 N 件 / 未分類 N 件」の内訳を出す。
        // 未分類の件数が、続く一括分類でユーザーが手を入れる件数になる
        <ul className={styles.summaryList}>
          <li>新規候補: {job.summary.newCount} 件</li>
          <li>自動分類の見込み: {job.summary.autoClassifiedEstimateCount} 件</li>
          <li>未分類の見込み: {job.summary.unclassifiedEstimateCount} 件</li>
          <li>重複除外: {job.summary.duplicateExcludedCount} 件</li>
        </ul>
      )}
      {job.failureReason && (
        // 失敗は挿入時にも読み上げられるよう alert にする（外側の polite リージョンとは別扱い）
        <ErrorState>{describeImportFailure(job.failureReason)}</ErrorState>
      )}
    </section>
  )
}
