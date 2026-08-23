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
import {
  apiFetch,
  apiMutate,
  ApiError,
  NetworkError,
  describeRequestFailure,
  UPLOAD_TIMEOUT_MS,
} from '@/lib/api-client'
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
import { formatDate, formatDateWithYear, getCurrentMonth } from '@/lib/month'
import { LuCircleCheck } from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { ImportJobCard } from '@/components/imports/ImportJobCard'
import { StatementGuide } from '@/components/imports/StatementGuide'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/SegmentedControl'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

const FILE_KIND_LABELS: Record<StatementFileKind, string> = {
  card_statement: 'カード利用明細',
  bank_statement: '銀行入出金明細',
}

/*
 * 取得手順ガイドの並びと、種別の切り替えの選択肢の並び。
 *
 * spec §10.1 ③「アップロード対象カード（2 種）」。種別の列挙はドメインを単一ソースにし、
 * 画面側で 2 度書かない(2 か所に散ると、片方だけ増減したときに並びがずれる)
 */
const FILE_KIND_OPTIONS: readonly SegmentedControlOption<StatementFileKind>[] =
  StatementFileKindSchema.options.map(kind => ({ value: kind, label: FILE_KIND_LABELS[kind] }))

/** 1 回のアップロードで送る内容。送り直しに備えて送信時の値のまま保持する */
interface UploadRequest {
  file: File
  format: UploadFileFormat
  targetMonth: YearMonth
  kind: StatementFileKind
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
        <ErrorState
          onRetry={() => void candidatesQuery.refetch()}
          isRetrying={candidatesQuery.isFetching}
        >
          {describeRequestFailure(candidatesQuery.error, '候補の取得に失敗しました')}
        </ErrorState>
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
              {/* 通信の失敗は共通文言そのものが次の行動を含むため包まない。
                  包むと「…（電波の良い場所で…）。もう一度お試しください。」と案内が二重になる */}
              {describeRequestFailure(
                confirm.error,
                `確定できませんでした（${confirm.error.message}）。もう一度お試しください。`,
              )}
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
  /**
   * 直前に送った内容。通信が失敗したときに選び直さず送り直せるようにするため保持する
   * (`docs/design/usability.md` §1-3)。ファイル選択の input は送信後に空にしているため、
   * ここで持っていないと再試行のたびに端末のファイル選択からやり直しになる。
   *
   * 対象月・ファイル種別も送った時点の値で持つ。画面の現在値を見て送り直すと、失敗後に
   * 月を切り替えてから押したときに、選んだ覚えのない月へ取り込まれる
   */
  const [lastUpload, setLastUpload] = useState<UploadRequest | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const statusQuery = useQuery({
    queryKey: ['imports', 'status', month],
    queryFn: () => apiFetch(`/api/imports/status?month=${month}`, ImportStatusResponseSchema),
  })

  const upload = useMutation({
    mutationFn: async ({ file, format, targetMonth, kind }: UploadRequest) => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('targetMonth', targetMonth)
      formData.append('fileKind', kind)
      return apiMutate(
        uploadPath(format),
        // PDF はサーバー側の変換を待ってから応答が返るため、既定より長い打ち切り時間を使う
        { method: 'POST', body: formData, timeoutMs: UPLOAD_TIMEOUT_MS },
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
        const request: UploadRequest = {
          file,
          format: checked.format,
          targetMonth: month,
          kind: fileKind,
        }
        setLastUpload(request)
        upload.mutate(request)
      } else {
        // 対応外・サイズ超過はアップロードせずにその場で伝える（無駄な待ち時間を作らない）
        // 直前の送信の失敗は片付ける。残したままだと、選び直しを促す文言の隣に
        // 「もう一度アップロード」が出て、押すと今選んだファイルではなく前のファイルが飛ぶ
        upload.reset()
        setLastUpload(null)
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
            ...(upload.error instanceof NetworkError ? { network: true } : {}),
            ...(upload.error instanceof ApiError
              ? { status: upload.error.status, ...parseErrorReason(upload.error.body) }
              : {}),
          },
    hasJob: job !== null,
  })

  /*
   * 送り直しを出す条件。選択そのものを拒否した場合（対応外の拡張子・サイズ超過）は
   * 同じファイルを送り直しても結果が変わらないため出さない（選び直しが正しい行動）。
   *
   * 送信中も出したままにする。押した瞬間に消すと、キーボード・支援技術の利用者は
   * フォーカスの居場所を失い、押せたのかどうかも分からなくなる
   */
  const retryableUpload =
    selectionError === null && job === null && (upload.error !== null || upload.isPending)
      ? lastUpload
      : null

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
          <ErrorState
            onRetry={() => void statusQuery.refetch()}
            isRetrying={statusQuery.isFetching}
          >
            {describeRequestFailure(statusQuery.error, '取込状況の取得に失敗しました')}
          </ErrorState>
        )}
        {statusQuery.data &&
          (completion !== null ? (
            <div className={styles.statusDone}>
              <LuCircleCheck
                aria-hidden="true"
                className={`${ui.iconSm} ${styles.statusDoneIcon}`}
              />
              取込完了（{formatDateWithYear(completion.completedAt)}）
            </div>
          ) : (
            <EmptyState>
              この月の明細取込はまだ完了していません。下のアップロードから CSV か明細 PDF
              を取り込んでください。
            </EmptyState>
          ))}
      </section>

      {FILE_KIND_OPTIONS.map(({ value: kind }) => (
        <StatementGuide key={kind} fileKind={kind} month={month} />
      ))}

      <section className={ui.card} aria-labelledby="import-upload-title">
        <h2 id="import-upload-title" className={ui.sectionTitle}>
          明細ファイルのアップロード
        </h2>
        <SegmentedControl
          label="ファイル種別"
          options={FILE_KIND_OPTIONS}
          value={fileKind}
          onChange={setFileKind}
        />
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
          はアップロード後に明細を読み取るため、完了まで数分かかることがあります。
        </p>
        {errorMessage !== null && <ErrorState>{errorMessage}</ErrorState>}
        {retryableUpload !== null && (
          <button
            className={ui.buttonGhost}
            disabled={upload.isPending}
            onClick={() => {
              setJob(null)
              setUploadingFormat(retryableUpload.format)
              upload.mutate(retryableUpload)
            }}
          >
            {upload.isPending ? 'アップロード中...' : 'もう一度アップロード'}
          </button>
        )}
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
    <Suspense fallback={<LoadingState announce={false} />}>
      <ImportsPageContent />
    </Suspense>
  )
}
