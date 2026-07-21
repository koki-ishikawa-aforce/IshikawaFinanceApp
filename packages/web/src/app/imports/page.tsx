'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { YearMonth } from '@warimaru/domain'
import { MonthNavigator } from '@/components/dashboard/MonthNavigator'
import { apiFetch, apiMutate, ApiError } from '@/lib/api-client'
import {
  CandidatesResponseSchema,
  ConfirmResponseSchema,
  CsvUploadResponseSchema,
  ImportStatusResponseSchema,
  UnknownResponseSchema,
  type ImportJobWire,
} from '@/lib/api-schemas'
import { formatMoney } from '@/lib/format'
import { formatDate, formatDateTime, getCurrentMonth } from '@/lib/month'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

const JOB_LABELS: Record<ImportJobWire['kind'], string> = {
  upload_accepted: '受付済み',
  pdf_converting: 'PDF変換中',
  format_validating: '形式検証中',
  importing: '取込中',
  completed: '取込完了',
  failed: '失敗',
}

const FILE_KIND_LABELS = {
  card_statement: 'カード利用明細',
  bank_statement: '銀行入出金明細',
} as const
type FileKind = keyof typeof FILE_KIND_LABELS

interface CandidatesPanelProps {
  importJobId: string
  onDone: () => void
}

function CandidatesPanel({ importJobId, onDone }: CandidatesPanelProps) {
  const queryClient = useQueryClient()
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const [confirmResult, setConfirmResult] = useState<{
    confirmedCount: number
    alreadyConfirmedCount: number
  } | null>(null)

  const candidatesQuery = useQuery({
    queryKey: ['imports', 'candidates', importJobId],
    queryFn: () =>
      apiFetch(`/api/imports/${importJobId}/candidates`, CandidatesResponseSchema),
  })

  const candidates = candidatesQuery.data?.candidates ?? []
  const confirmable = candidates.filter(candidate => candidate.kind !== 'confirmed')
  const selectedIds = confirmable
    .map(candidate => candidate.common.transactionCandidateId)
    .filter(id => !excluded.has(id))

  const confirm = useMutation({
    mutationFn: () =>
      apiMutate(
        `/api/imports/${importJobId}/confirm`,
        {
          method: 'PUT',
          body:
            excluded.size === 0 ? {} : { transactionCandidateIds: selectedIds },
        },
        ConfirmResponseSchema,
      ),
    onSuccess: async result => {
      setConfirmResult(result)
      await queryClient.invalidateQueries({ queryKey: ['imports'] })
      await queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })

  const toggle = (id: string) => {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (confirmResult !== null) {
    return (
      <div className={ui.card}>
        <span className={ui.sectionTitle}>確定完了</span>
        <p className={styles.note}>
          {confirmResult.confirmedCount} 件を未分類取引として登録しました
          {confirmResult.alreadyConfirmedCount > 0 &&
            `（${confirmResult.alreadyConfirmedCount} 件は確定済みでした）`}
          。取引一覧ページで分類できます。
        </p>
        <button className={ui.button} onClick={onDone}>
          閉じる
        </button>
      </div>
    )
  }

  return (
    <div className={ui.card}>
      <div className={ui.rowBetween}>
        <span className={ui.sectionTitle}>取込候補の確認</span>
        <button className={styles.smallGhost} onClick={onDone}>
          閉じる
        </button>
      </div>
      {candidatesQuery.isLoading && <div className={ui.loading}>読み込み中...</div>}
      {candidatesQuery.error && <div className={ui.error}>候補の取得に失敗しました</div>}
      {!candidatesQuery.isLoading && candidates.length === 0 && (
        <div className={ui.empty}>候補がありません（すべて重複除外された可能性があります）</div>
      )}
      {candidates.length > 0 && (
        <>
          <p className={styles.note}>
            チェックを外した行は確定から除外されます（{selectedIds.length} / {confirmable.length}{' '}
            件を確定）
          </p>
          <ul className={styles.candidateList}>
            {candidates.map(candidate => {
              const id = candidate.common.transactionCandidateId
              const confirmed = candidate.kind === 'confirmed'
              return (
                <li key={id} className={styles.candidateRow}>
                  <label className={styles.candidateLabel}>
                    <input
                      type="checkbox"
                      disabled={confirmed}
                      checked={!confirmed && !excluded.has(id)}
                      onChange={() => toggle(id)}
                    />
                    <span className={styles.candidateBody}>
                      <span className={styles.candidateDate}>
                        {formatDate(candidate.common.occurredAt)}
                      </span>
                      <span className={styles.candidateMerchant}>
                        {candidate.common.merchantName}
                      </span>
                    </span>
                  </label>
                  <span className={styles.candidateAmount}>
                    {formatMoney(candidate.common.amount)}
                    {confirmed && <span className={ui.badge}>確定済</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          {confirm.error && <div className={ui.error}>{confirm.error.message}</div>}
          <button
            className={ui.button}
            disabled={selectedIds.length === 0 || confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending
              ? '確定中...'
              : excluded.size === 0
                ? 'すべて確定する'
                : `選択した ${selectedIds.length} 件を確定する`}
          </button>
        </>
      )}
    </div>
  )
}

export default function ImportsPage() {
  const queryClient = useQueryClient()
  const [month, setMonth] = useState<YearMonth>(getCurrentMonth)
  const [fileKind, setFileKind] = useState<FileKind>('card_statement')
  const [job, setJob] = useState<ImportJobWire | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const statusQuery = useQuery({
    queryKey: ['imports', 'status', month],
    queryFn: () => apiFetch(`/api/imports/status?month=${month}`, ImportStatusResponseSchema),
  })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('targetMonth', month)
      formData.append('fileKind', fileKind)
      return apiMutate('/api/imports/csv', { method: 'POST', body: formData }, CsvUploadResponseSchema)
    },
    onSuccess: async response => {
      setJob(response.job)
      await queryClient.invalidateQueries({ queryKey: ['imports'] })
    },
    onError: (error: Error) => {
      // 形式検証エラー（422）はジョブ情報付きで返る
      if (error instanceof ApiError && error.status === 422) {
        try {
          const parsed = CsvUploadResponseSchema.parse(JSON.parse(error.body))
          setJob(parsed.job)
        } catch {
          // ジョブ形式でないエラーボディは通常のエラー表示に任せる
        }
      }
    },
  })

  const handleFileChange = (files: FileList | null) => {
    const file = files?.[0]
    if (file !== undefined) {
      setJob(null)
      upload.mutate(file)
    }
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = ''
    }
  }

  const completion = statusQuery.data?.completion ?? null

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>CSV 取込</h1>
      <MonthNavigator month={month} onMonthChange={setMonth} />

      <div className={ui.card}>
        <span className={ui.sectionTitle}>この月の取込状況</span>
        {statusQuery.isLoading && <div className={ui.loading}>読み込み中...</div>}
        {statusQuery.error && <div className={ui.error}>取込状況の取得に失敗しました</div>}
        {statusQuery.data &&
          (completion !== null ? (
            <div className={styles.statusDone}>
              ✅ 取込完了（{formatDateTime(completion.completedAt)}）
            </div>
          ) : (
            <div className={ui.empty}>この月の CSV 取込はまだ完了していません</div>
          ))}
      </div>

      <div className={ui.card}>
        <span className={ui.sectionTitle}>CSV アップロード</span>
        <div className={ui.field}>
          <label className={ui.fieldLabel}>ファイル種別</label>
          <select
            className={ui.select}
            value={fileKind}
            onChange={e => setFileKind(e.target.value as FileKind)}
          >
            {Object.entries(FILE_KIND_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className={styles.hiddenInput}
          onChange={e => handleFileChange(e.target.files)}
        />
        <button
          className={ui.button}
          disabled={upload.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          {upload.isPending ? 'アップロード中...' : 'CSV ファイルを選択して取込'}
        </button>
        {upload.error && job === null && <div className={ui.error}>{upload.error.message}</div>}
      </div>

      {job !== null && (
        <div className={ui.card}>
          <div className={ui.rowBetween}>
            <span className={ui.sectionTitle}>取込ジョブ</span>
            <span className={job.kind === 'failed' ? styles.failedBadge : ui.badgeAccent}>
              {JOB_LABELS[job.kind]}
            </span>
          </div>
          {job.summary && (
            <ul className={styles.summaryList}>
              <li>新規候補: {job.summary.newCount} 件</li>
              <li>重複除外: {job.summary.duplicateExcludedCount} 件</li>
            </ul>
          )}
          {job.failure && <div className={ui.error}>{job.failure.failureDetail}</div>}
        </div>
      )}

      {job !== null && job.kind === 'completed' && (
        <CandidatesPanel importJobId={job.common.importJobId} onDone={() => setJob(null)} />
      )}
    </main>
  )
}
