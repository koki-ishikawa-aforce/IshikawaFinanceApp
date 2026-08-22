'use client'

import { Suspense, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  StatementFileKindSchema,
  YearMonthSchema,
  type StatementFileKind,
  type UploadFileFormat,
  type YearMonth,
} from '@warimaru/domain'
import { MonthNavigator } from '@/components/dashboard/MonthNavigator'
import { apiFetch, apiMutate, ApiError } from '@/lib/api-client'
import {
  CandidatesResponseSchema,
  ConfirmResponseSchema,
  ImportStatusResponseSchema,
  ImportUploadResponseSchema,
  UnknownResponseSchema,
  type ImportJobWire,
} from '@/lib/api-schemas'
import { checkUploadFile, describeUploadError, uploadPath } from '@/lib/import-upload'
import { formatMoney } from '@/lib/format'
import { formatDate, formatDateTime, getCurrentMonth } from '@/lib/month'
import { LuCircleCheck } from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { ImportJobCard } from '@/components/imports/ImportJobCard'
import { StatementGuide } from '@/components/imports/StatementGuide'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

const FILE_KIND_LABELS: Record<StatementFileKind, string> = {
  card_statement: 'カード利用明細',
  bank_statement: '銀行入出金明細',
}

interface CandidatesPanelProps {
  importJobId: string
  month: YearMonth
  onDone: () => void
}

function CandidatesPanel({ importJobId, month, onDone }: CandidatesPanelProps) {
  const queryClient = useQueryClient()
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const [confirmResult, setConfirmResult] = useState<{
    confirmedCount: number
    alreadyConfirmedCount: number
  } | null>(null)

  const candidatesQuery = useQuery({
    queryKey: ['imports', 'candidates', importJobId],
    queryFn: () => apiFetch(`/api/imports/${importJobId}/candidates`, CandidatesResponseSchema),
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
          body: excluded.size === 0 ? {} : { transactionCandidateIds: selectedIds },
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
      <section className={ui.card} aria-labelledby="import-confirm-title">
        <h2 id="import-confirm-title" className={ui.sectionTitle}>
          確定完了
        </h2>
        <p className={styles.note}>
          {confirmResult.confirmedCount} 件を未分類取引として登録しました
          {confirmResult.alreadyConfirmedCount > 0 &&
            `（${confirmResult.alreadyConfirmedCount} 件は確定済みでした）`}
          。取引一覧でまとめて分類できます。
        </p>
        {/* AT-302: 取込サマリから一括分類へ繋ぐ導線。分類そのものは取引一覧で行う */}
        <Link
          className={`${ui.button} ${ui.buttonLink}`}
          href={`/transactions?month=${month}&importJobId=${importJobId}`}
        >
          取引一覧でまとめて分類する
        </Link>
        <button className={ui.buttonGhost} onClick={onDone}>
          閉じる
        </button>
      </section>
    )
  }

  return (
    <section className={ui.card} aria-labelledby="import-candidates-title">
      <div className={ui.rowBetween}>
        <h2 id="import-candidates-title" className={ui.sectionTitle}>
          取込候補の確認
        </h2>
        <button className={styles.smallGhost} onClick={onDone}>
          閉じる
        </button>
      </div>
      {candidatesQuery.isLoading && <LoadingState />}
      {candidatesQuery.error && (
        <>
          <ErrorState>候補の取得に失敗しました</ErrorState>
          <button className={ui.buttonGhost} onClick={() => void candidatesQuery.refetch()}>
            再読み込み
          </button>
        </>
      )}
      {!candidatesQuery.isLoading && candidates.length === 0 && (
        <EmptyState>候補がありません（すべて重複除外された可能性があります）</EmptyState>
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
          {confirm.error && (
            <ErrorState>
              確定できませんでした（{confirm.error.message}）。もう一度お試しください。
            </ErrorState>
          )}
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
    </section>
  )
}

/** エラー応答の機械可読な理由（`{ error, reason }`）を取り出す。理由が無ければ空 */
function parseErrorReason(body: string): { reason?: string } {
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed !== null && typeof parsed === 'object' && 'reason' in parsed) {
      const reason = (parsed as { reason: unknown }).reason
      if (typeof reason === 'string') return { reason }
    }
  } catch {
    // JSON でないボディは理由なしとして扱う
  }
  return {}
}

function parseMonthParam(value: string | null): YearMonth {
  const parsed = YearMonthSchema.safeParse(value)
  return parsed.success ? parsed.data : getCurrentMonth()
}

function ImportsPageContent() {
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const [month, setMonth] = useState<YearMonth>(() => parseMonthParam(searchParams.get('month')))
  const [fileKind, setFileKind] = useState<StatementFileKind>('card_statement')
  const [job, setJob] = useState<ImportJobWire | null>(null)
  /** アップロードせずに拒否した選択（対応外の拡張子）の文言 */
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [uploadingFormat, setUploadingFormat] = useState<UploadFileFormat | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const statusQuery = useQuery({
    queryKey: ['imports', 'status', month],
    queryFn: () => apiFetch(`/api/imports/status?month=${month}`, ImportStatusResponseSchema),
  })

  const upload = useMutation({
    mutationFn: async ({ file, format }: { file: File; format: UploadFileFormat }) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('targetMonth', month)
      formData.append('fileKind', fileKind)
      return apiMutate(
        uploadPath(format),
        { method: 'POST', body: formData },
        ImportUploadResponseSchema,
      )
    },
    onSuccess: async response => {
      setJob(response.job)
      await queryClient.invalidateQueries({ queryKey: ['imports'] })
    },
    onError: (error: Error) => {
      // 形式検証エラー・PDF 変換失敗（422）はジョブ情報付きで返る
      if (error instanceof ApiError && error.status === 422) {
        try {
          const parsed = ImportUploadResponseSchema.parse(JSON.parse(error.body))
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
      const checked = checkUploadFile(file)
      if (checked.ok) {
        setSelectionError(null)
        setUploadingFormat(checked.format)
        upload.mutate({ file, format: checked.format })
      } else {
        // 対応外・サイズ超過はアップロードせずにその場で伝える（無駄な待ち時間を作らない）
        setSelectionError(checked.message)
      }
    }
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = ''
    }
  }

  const errorMessage = describeUploadError({
    selectionError,
    error:
      upload.error === null
        ? null
        : {
            message: upload.error.message,
            ...(upload.error instanceof ApiError
              ? { status: upload.error.status, ...parseErrorReason(upload.error.body) }
              : {}),
          },
    hasJob: job !== null,
  })

  const completion = statusQuery.data?.completion ?? null

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>明細取込</h1>
      <MonthNavigator month={month} onMonthChange={setMonth} />

      <section className={ui.card} aria-labelledby="import-status-title">
        <h2 id="import-status-title" className={ui.sectionTitle}>
          この月の取込状況
        </h2>
        {statusQuery.isLoading && <LoadingState />}
        {statusQuery.error && (
          <>
            <ErrorState>取込状況の取得に失敗しました</ErrorState>
            <button className={ui.buttonGhost} onClick={() => void statusQuery.refetch()}>
              再読み込み
            </button>
          </>
        )}
        {statusQuery.data &&
          (completion !== null ? (
            <div className={styles.statusDone}>
              <LuCircleCheck aria-hidden="true" className={styles.statusDoneIcon} />
              取込完了（{formatDateTime(completion.completedAt)}）
            </div>
          ) : (
            <EmptyState>
              この月の明細取込はまだ完了していません。下のアップロードから CSV か明細 PDF
              を取り込んでください。
            </EmptyState>
          ))}
      </section>

      {/* spec §10.1 ③「アップロード対象カード（2 種）」。ファイル種別の列挙はドメインを単一ソースにする */}
      {StatementFileKindSchema.options.map(kind => (
        <StatementGuide key={kind} fileKind={kind} month={month} />
      ))}

      <section className={ui.card} aria-labelledby="import-upload-title">
        <h2 id="import-upload-title" className={ui.sectionTitle}>
          明細ファイルのアップロード
        </h2>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor="import-file-kind">
            ファイル種別
          </label>
          <select
            id="import-file-kind"
            className={ui.select}
            value={fileKind}
            onChange={e => setFileKind(e.target.value as StatementFileKind)}
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
          accept=".csv,text/csv,.pdf,application/pdf"
          className={styles.hiddenInput}
          onChange={e => handleFileChange(e.target.files)}
        />
        <button
          className={ui.button}
          disabled={upload.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          {upload.isPending
            ? uploadingFormat === 'pdf'
              ? 'PDF を変換中...'
              : 'アップロード中...'
            : 'CSV / PDF ファイルを選択して取込'}
        </button>
        <p className={styles.note}>
          CSV(.csv)と明細 PDF(.pdf)を取り込めます。PDF
          はアップロード後に明細を読み取るため、完了まで 1 分ほどかかることがあります。
        </p>
        {errorMessage !== null && <ErrorState>{errorMessage}</ErrorState>}
      </section>

      {/* 取込の進行・結果は操作後に差し替わる。ライブリージョンは常時マウントしておかないと
          挿入が検出されないため、カードではなくこの入れ物に置く（usability §8-4） */}
      <div aria-live="polite">{job !== null && <ImportJobCard job={job} />}</div>

      {job !== null && job.kind === 'completed' && (
        <CandidatesPanel
          importJobId={job.common.importJobId}
          month={month}
          onDone={() => setJob(null)}
        />
      )}
    </main>
  )
}

export default function ImportsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ImportsPageContent />
    </Suspense>
  )
}
