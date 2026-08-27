/**
 * 日次メール取込バッチ集約（取引取込コンテキスト）
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/domain/09-aggregates.md #2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * kawasima: data 日次メール取込バッチ = 起動済み OR 取込中 OR 完了 OR 失敗
 *
 * 不変条件:
 *  - バッチ起動中は同一ユーザーID の二重起動が発生しない
 *    （Repository.findInProgressByUser で保証、Phase 5 M-B）
 *  - 完了・失敗の終端状態からは遷移しない（終端からの遷移関数を提供しない）
 *  - 取込対象期間は from < to（過去 5 日再走査、OQ-31）
 *
 * 起動の事前条件（集約 1 個の状態だけでは判定できないため不変条件には数えない）:
 *  - API 経由の手動起動は直前の実行からクールダウンを空ける。ただし直前の実行が失敗（終端）
 *    なら短縮した下限まで待てばよい（#489 / #628。`judgeManualMailImportCooldown`）
 */
import { z } from 'zod'
import { InvariantViolationError } from '../../shared/errors/DomainError'
import { ImportBatchIdSchema, UserIdSchema } from '../../shared/ids'

/** 取込対象期間 */
export const ImportTargetPeriodSchema = z.object({
  from: z.date(),
  to: z.date(),
})
export type ImportTargetPeriod = z.infer<typeof ImportTargetPeriodSchema>

/** 共通属性 */
export const CommonImportBatchAttrsSchema = z.object({
  importBatchId: ImportBatchIdSchema,
  userId: UserIdSchema,
  launchedAt: z.date(),
  targetPeriod: ImportTargetPeriodSchema,
})
export type CommonImportBatchAttrs = z.infer<typeof CommonImportBatchAttrsSchema>

export const DailyMailImportBatchSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('started'),
      common: CommonImportBatchAttrsSchema,
    }),
    z.object({
      kind: z.literal('importing'),
      common: CommonImportBatchAttrsSchema,
      importStartedAt: z.date(),
      importedCount: z.number().int().nonnegative(),
    }),
    z.object({
      kind: z.literal('completed'),
      common: CommonImportBatchAttrsSchema,
      completedAt: z.date(),
      importedCount: z.number().int().nonnegative(),
      duplicateExcludedCount: z.number().int().nonnegative(),
      failedCount: z.number().int().nonnegative(),
    }),
    z.object({
      kind: z.literal('failed'),
      common: CommonImportBatchAttrsSchema,
      failedAt: z.date(),
      failureDetail: z.string().min(1),
    }),
  ])
  .superRefine((batch, ctx) => {
    if (batch.common.targetPeriod.from >= batch.common.targetPeriod.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '取込対象期間は from < to でなければならない',
        path: ['common', 'targetPeriod'],
      })
    }
  })
export type DailyMailImportBatch = z.infer<typeof DailyMailImportBatchSchema>

export type StartedImportBatch = Extract<DailyMailImportBatch, { kind: 'started' }>
export type ImportingImportBatch = Extract<DailyMailImportBatch, { kind: 'importing' }>
export type CompletedImportBatch = Extract<DailyMailImportBatch, { kind: 'completed' }>
export type FailedImportBatch = Extract<DailyMailImportBatch, { kind: 'failed' }>

/** 状態遷移: 起動済み → 取込中 */
export function startBatchImporting(batch: StartedImportBatch, at: Date): ImportingImportBatch {
  return DailyMailImportBatchSchema.parse({
    kind: 'importing',
    common: batch.common,
    importStartedAt: at,
    importedCount: 0,
  }) as ImportingImportBatch
}

/**
 * 状態遷移: 取込中 → 取込中（前の実行が残したバッチの引き継ぎ）。
 *
 * 取込済み件数は引き継ぐが、取込を始めた時刻は引き継いだ実行のものに更新する。この時刻は
 * 「そのバッチが最後に動き出した時刻」として手動実行のクールダウン判定の起点になるため、
 * 前の実行の時刻のまま残すと、いま走っている実行の最中に叩き直された手動実行を止められない。
 */
export function resumeBatchImporting(batch: ImportingImportBatch, at: Date): ImportingImportBatch {
  return DailyMailImportBatchSchema.parse({
    ...batch,
    importStartedAt: at,
  }) as ImportingImportBatch
}

/**
 * 取込中の進捗を更新する（取込中 → 取込中）。
 *
 * 途中でワーカーが落ちたとき、どこまで取り込めていたかが記録に残るようにする
 * （`StatementImportJob.updateProcessedCount` と同じ役割）。取り込み済み件数は減らない
 * — 減る更新は「再走査で候補が消えた」ように見え、進捗の記録として成立しない。
 */
export function updateBatchImportedCount(
  batch: ImportingImportBatch,
  importedCount: number,
): ImportingImportBatch {
  if (importedCount < batch.importedCount) {
    throw new InvariantViolationError('取込済み件数は減らせない')
  }
  return DailyMailImportBatchSchema.parse({
    ...batch,
    importedCount,
  }) as ImportingImportBatch
}

/** 状態遷移: 取込中 → 完了（終端） */
export function completeBatch(
  batch: ImportingImportBatch,
  counts: { importedCount: number; duplicateExcludedCount: number; failedCount: number },
  at: Date,
): CompletedImportBatch {
  return DailyMailImportBatchSchema.parse({
    kind: 'completed',
    common: batch.common,
    completedAt: at,
    ...counts,
  }) as CompletedImportBatch
}

/**
 * 手動実行（`POST /api/imports/mail-batch`）を受け付けない期間の長さ。
 *
 * 日次の自動起動には掛けない。手で叩いたときだけの制限で、狙いは 2 つある:
 *  - 実行中に重ねて叩かれると、進行中バッチを引き継ぐ経路（`findInProgressByUser` で拾って
 *    再開する）に 2 つの実行が同時に乗り、同じバッチ記録を両方が書き換える
 *  - 本番の前段（API Gateway 想定）は 30 秒前後で応答を切るため、実行した人には「失敗した」
 *    ように見える。処理自体は続いているので、そこで叩き直すと上の状態になりやすい
 *
 * 長さは「1 回の取込が終わるのに掛かる時間」より長く取る（Gmail の取得だけで最大 2 分、
 * 候補の保存を含めて数分）。これより長く走り続けている実行はクールダウンを過ぎた再実行と
 * 重なりうるが、その場合も同じメールから取引候補が二重に作られることは Gmail message ID の
 * 一意制約が防ぐ（重なるのはバッチ記録の書き換えまで）。
 */
export const MANUAL_MAIL_IMPORT_COOLDOWN_MS = 10 * 60 * 1000

/**
 * 直近の実行が失敗（終端）で終わっている場合に適用する、短縮したクールダウン（#628 の決定）。
 *
 * 失敗直後は「もう動いていない」ことが確定しているため、二重起動を避ける狙いの通常クールダウン
 * （`MANUAL_MAIL_IMPORT_COOLDOWN_MS`）を待たせる理由は無い。ただし間隔を完全に無くすと、Gmail
 * API 自体がレート制限（429・5xx。`GmailMailFetchGateway` の `other_fetch_failure` に含まれる）
 * で失敗しているときに、バックオフ無しで即座に叩き直せてしまい、失敗が失敗を呼ぶ連打を止める
 * 手立てが無くなる。数十秒程度の下限を残すことで、人が「今すぐやり直したい」という要求は満たし
 * つつ、機械的な連打（ブラウザの多重クリック・スクリプトからの即時リトライ）だけは間引く。
 */
export const FAILED_MANUAL_MAIL_IMPORT_RETRY_FLOOR_MS = 30 * 1000

/**
 * 手動実行を受け付けてよいかの判定。待つ必要があるときは残り時間と、待たせる理由になった
 * 直近バッチの状態を持つ（呼出し元が「まだ動いている」と「直前に終わった」を言い分けられる）
 */
export type ManualMailImportCooldownJudgment =
  | { kind: 'acceptable' }
  | {
      kind: 'cooling_down'
      retryAfterMs: number
      latestBatchKind: DailyMailImportBatch['kind']
    }

/**
 * そのバッチが最後に動いた時刻。
 *
 * 取込中バッチの `importStartedAt` は取込を始めた（または起動済みから引き継いだ）時刻で、
 * 取込の進捗ではそれ以上進まない。クールダウンの起点としては「その実行が始まった時刻」に
 * なる。
 */
function lastActivityAt(batch: DailyMailImportBatch): Date {
  switch (batch.kind) {
    case 'started':
      return batch.common.launchedAt
    case 'importing':
      return batch.importStartedAt
    case 'completed':
      return batch.completedAt
    case 'failed':
      return batch.failedAt
  }
}

/**
 * 手動実行を受け付けてよいかを判定する（#489 の決定、失敗直後の扱いは #628 の決定）。
 *
 * `latestBatch` はそのユーザーの直近のバッチ（状態を問わない。無ければ null）。直近バッチが
 * `failed`（終端。もう動いていないことが確定している）なら、通常のクールダウンではなく短縮した
 * `failedRetryFloorMs` を適用する — 二重起動を避ける狙いは失敗した実行には当てはまらないが、
 * 外部 API（Gmail）のレート制限中の連打を防ぐ下限は残す（`FAILED_MANUAL_MAIL_IMPORT_RETRY_FLOOR_MS`
 * の JSDoc 参照）。それ以外の状態では `cooldownMs` を適用する。適用したクールダウンの長さ未満
 * なら受け付けず残り時間を返す。過ぎていれば受け付ける — 途中で落ちた取込の引き継ぎ自体は
 * 止めない（止めると、落ちた実行の対象期間が二度と走査されない）。
 *
 * 判定系は value-objects / services に置くのが本パッケージの通例だが、この判定が読むのは
 * バッチ集約の状態と時刻だけなので、状態ごとの最終活動時刻を知る集約側に同居させている。
 */
export function judgeManualMailImportCooldown(
  latestBatch: DailyMailImportBatch | null,
  at: Date,
  cooldownMs: number = MANUAL_MAIL_IMPORT_COOLDOWN_MS,
  failedRetryFloorMs: number = FAILED_MANUAL_MAIL_IMPORT_RETRY_FLOOR_MS,
): ManualMailImportCooldownJudgment {
  if (latestBatch === null) return { kind: 'acceptable' }
  const effectiveCooldownMs = latestBatch.kind === 'failed' ? failedRetryFloorMs : cooldownMs
  const elapsedMs = at.getTime() - lastActivityAt(latestBatch).getTime()
  // 経過が負（直近バッチの時刻が未来）になるのは時計のずれ。待たせる側に倒す
  if (elapsedMs >= effectiveCooldownMs) return { kind: 'acceptable' }
  // 待ち時間はクールダウンを超えない。経過が負のときに引き算をそのまま返すと、時計のずれが
  // そのまま待ち時間に乗って「いつまで待てばよいか」が実際より長く案内される
  return {
    kind: 'cooling_down',
    retryAfterMs: Math.min(effectiveCooldownMs, effectiveCooldownMs - elapsedMs),
    latestBatchKind: latestBatch.kind,
  }
}

/** 状態遷移: 起動済み/取込中 → 失敗（終端） */
export function failBatch(
  batch: StartedImportBatch | ImportingImportBatch,
  failureDetail: string,
  at: Date,
): FailedImportBatch {
  return DailyMailImportBatchSchema.parse({
    kind: 'failed',
    common: batch.common,
    failedAt: at,
    failureDetail,
  }) as FailedImportBatch
}
