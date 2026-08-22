/**
 * 日次メール取込ワーカー（08a §2「Gmail からメールを取得する」〜「カード利用通知から取引候補を生成する」）
 *
 * 三井住友カードの利用通知メールが届いたら、その内容を家計簿の「取引候補」として自動で溜める。
 * 起動済みのバッチ記録（`POST /api/imports/mail-batch` が作るもの）を、取得 → 重複除外 →
 * パース → 候補生成 → 完了 まで進めるのが本モジュールの責務で、次の 2 つの起点から同じ形で
 * 呼べるようにまとめてある:
 *
 *  - `POST /api/imports/mail-batch`（`routes/imports.ts`）— 手動実行
 *  - 日次のスケジューラ起動 — 世帯の全ユーザーぶんを一括で取り込む
 *    （EventBridge → Lambda エントリポイントの配線は #416）
 *
 * 取込対象期間は「過去 `scanDays` 日（既定 5 日）から起動時刻まで」を毎回スキャンする（論点22 /
 * OQ-31）。同じメールを何度も取得することになるが、Gmail message ID による重複除外があるため
 * 候補は増えない。数日ぶん遡ることで、1 日ぶんの取込が落ちても翌日の実行で自動的に回収される。
 *
 * 重複除外は 2 段構えで、どちらも Gmail message ID の一致で判定する（08a §2「メールの重複を
 * 判定する」）:
 *  1. 保存済みの取引候補との照合（`findByGmailMessageId`）
 *  2. 同一バッチ内で同じ ID が 2 度返った場合の照合（取得側の重複）
 * 加えて、確認と保存の間に別の実行が同じ候補を作った場合（同時起動）は保存が一意制約違反に
 * なるが、これも重複除外として扱う（結末が実際の状態と食い違わないようにする）。
 *
 * パースは注入する（`SmbcNotificationMailParser`）。実パースルールは #415 が実装するため、
 * 本モジュールは「パース結果をどう扱うか」だけを持ち、本文の読み方は持たない。
 *
 * 候補にするのはカード利用通知だけ（08a §2「カード利用通知から取引候補を生成する」）。
 * 銀行入金・引落確定などの通知はパースには成功するが、反映先が別コンテキスト（残高管理・
 * 家計分析 #399）にあり本 Issue の範囲外のため、件数だけ数えて記録に残す（黙って捨てない）。
 *
 * 既知の制約: 保存とイベント発行はトランザクションで括れない（Neon HTTP ドライバ方針）。
 * 候補を保存した直後に落ちると、その候補の `TransactionCandidateExtracted` は出ないまま
 * 翌日の再走査では重複として除外される（イベントは出し直されない）。現時点で本イベントの
 * 購読者はいないため実害は無いが、購読者を足すときに at-most-once を許容するかの判断が要る。
 */
import {
  DailyMailImportBatchSchema,
  ImportBatchIdSchema,
  InvariantViolationError,
  MailFetchedSchema,
  MailImportBatchCompletedSchema,
  MailImportBatchLaunchedSchema,
  MailImportResumedSchema,
  MailParseFailedSchema,
  DuplicateExcludedSchema,
  TransactionCandidateExtractedSchema,
  TransactionCandidateIdSchema,
  TransactionCandidateSchema,
  UserRoleSchema,
  completeBatch,
  failBatch,
  startBatchImporting,
  updateBatchImportedCount,
} from '@warimaru/domain'
import type {
  AppUserRepository,
  DailyMailImportBatch,
  DailyMailImportBatchRepository,
  EventBus,
  GmailMailFetchGateway,
  GmailMessageId,
  GmailOAuthTokenRepository,
  ImportBatchId,
  ImportTargetPeriod,
  ImportingImportBatch,
  MailFetchFailure,
  SmbcMailParseResult,
  SmbcNotificationMailParser,
  StartedImportBatch,
  TransactionCandidateRepository,
  UserId,
  UserRole,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { domainEventBase } from './event-handlers/index.js'

/** 毎回さかのぼって再走査する日数（論点22 / OQ-31。実運用で調整するためのパラメータ） */
export const DEFAULT_MAIL_SCAN_DAYS = 5

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

/** 進捗（取込済み件数）を集約へ書き戻す間隔。1 件ごとに書くと保存回数がメール件数ぶん増える */
const PROGRESS_SAVE_INTERVAL = 10

export interface DailyMailImportDeps {
  dailyMailImportBatchRepository: DailyMailImportBatchRepository
  transactionCandidateRepository: TransactionCandidateRepository
  gmailOAuthTokenRepository: GmailOAuthTokenRepository
  gmailMailFetchGateway: GmailMailFetchGateway
  /** SMBC 通知メール本文のパース（実装は #415。それまでは未実装版が失敗を返す） */
  parseSmbcNotificationMail: SmbcNotificationMailParser
  eventBus: EventBus
}

export interface HouseholdDailyMailImportDeps extends DailyMailImportDeps {
  appUserRepository: AppUserRepository
}

export interface DailyMailImportParams {
  userId: UserId
  at?: Date
  /** さかのぼる日数（省略時 `DEFAULT_MAIL_SCAN_DAYS`）。`period` を渡した場合は使わない */
  scanDays?: number
  /** 取込対象期間を明示する（手動実行で期間を指定する場合）。from < to でなければ弾かれる */
  period?: ImportTargetPeriod
}

/**
 * 取込を止めた失敗の種別。再認可が要るのか、待てば直るのかを呼出し元が区別できるようにする。
 *  - `gmail_not_authorized`: Gmail 連携がまだ無い / 失効検知済みで再認可待ち
 *  - `oauth_revocation_detected`: 取得の途中でトークン失効を検知した（再認可導線 #392 の起点）
 *  - `other_fetch_failure`: 通信断・API 障害・設定不備などの取得失敗
 *  - `unexpected_error`: 取得後の処理（パース結果の保存など）で想定外の失敗が起きた
 */
export type DailyMailImportFailureKind =
  | 'gmail_not_authorized'
  | 'oauth_revocation_detected'
  | 'other_fetch_failure'
  | 'unexpected_error'

/**
 * 1 ユーザーぶんの取込結果。
 *
 * `resumed` は、前回の実行が最後まで進まずに残していたバッチを引き継いだかを表す。
 * `deferredCount` は、パースには成功したが本 Issue では候補にしない種別（銀行入金・引落確定
 * など）の件数で、`importedCount` にも `failedCount` にも入らない。
 */
export type DailyMailImportOutcome = {
  importBatchId: ImportBatchId
  targetPeriod: ImportTargetPeriod
  resumed: boolean
} & (
  | {
      status: 'completed'
      importedCount: number
      duplicateExcludedCount: number
      failedCount: number
      deferredCount: number
    }
  | {
      status: 'failed'
      failureKind: DailyMailImportFailureKind
      /** 同じ実行をやり直せば結果が変わりうるか（翌日の再走査で回収できるか） */
      retryable: boolean
      /** ログ・応答に載る短い文言。シークレット・PII・メール本文を含めない */
      failureDetail: string
    }
)

/** ログに出してよい識別子だけを持つ目印（ユーザーID = LINE userID は出さない） */
function batchLabel(batch: DailyMailImportBatch): string {
  return `importBatchId=${batch.common.importBatchId}`
}

/**
 * 取込対象期間を決めて、起動済みバッチの形で組み立てる。
 *
 * 進行中バッチの照会（DB 参照）より**先に**組み立てるのは、期間の不変条件（from < to）を
 * ドメインスキーマの parse で早期に弾くため。API 経由の手動実行で期間が逆転していると、
 * 「進行中バッチがある（409）」ではなく「期間が不正（400）」として返る。
 */
function buildLaunchedBatch(params: DailyMailImportParams, at: Date): StartedImportBatch {
  const scanDays = params.scanDays ?? DEFAULT_MAIL_SCAN_DAYS
  const targetPeriod = params.period ?? {
    from: new Date(at.getTime() - scanDays * MILLIS_PER_DAY),
    to: at,
  }
  return DailyMailImportBatchSchema.parse({
    kind: 'started',
    common: {
      importBatchId: ImportBatchIdSchema.parse(newUlid()),
      userId: params.userId,
      launchedAt: at,
      targetPeriod,
    },
  }) as StartedImportBatch
}

function failureKindOf(failure: MailFetchFailure): DailyMailImportFailureKind {
  return failure.kind === 'oauth_revocation_detected'
    ? 'oauth_revocation_detected'
    : 'other_fetch_failure'
}

/**
 * 起動済み / 取込中のバッチを取得 → パース → 候補生成 → 完了 まで進める。
 *
 * 進行中のバッチが残っていれば新しく起動せず、それを引き継いで再開する（08a §3
 * メール取込再開イベント）。前回の実行が途中で落ちた場合の続きがここに当たり、既に取り込んだ
 * ぶんは Gmail message ID の重複除外で二重生成されない。
 *
 * 取得に失敗したバッチは失敗（終端）として記録する。取込中のまま残すと二重起動防止の
 * ロックが解けず、翌日以降の取込まで止まる。
 */
export async function runDailyMailImportForUser(
  deps: DailyMailImportDeps,
  params: DailyMailImportParams,
): Promise<DailyMailImportOutcome> {
  const at = params.at ?? new Date()
  const launched = buildLaunchedBatch(params, at)

  const inProgress = await deps.dailyMailImportBatchRepository.findInProgressByUser(params.userId)
  const active =
    inProgress !== null && (inProgress.kind === 'started' || inProgress.kind === 'importing')
      ? inProgress
      : null

  let batch: ImportingImportBatch
  const resumed = active !== null
  if (active === null) {
    await deps.dailyMailImportBatchRepository.save(launched)
    await deps.eventBus.publish(
      MailImportBatchLaunchedSchema.parse({
        ...domainEventBase(at),
        type: 'MailImportBatchLaunched',
        importBatchId: launched.common.importBatchId,
        userId: params.userId,
        launchedAt: at,
      }),
    )
    batch = startBatchImporting(launched, at)
    await deps.dailyMailImportBatchRepository.save(batch)
  } else {
    // 前回の実行が残したバッチを引き継ぐ。取込対象期間はそのバッチが起動時に決めたものを使う
    // （引き継ぎ先の期間で取り直すと、前回ぶんの取りこぼしが検索範囲から外れうる）
    batch = active.kind === 'started' ? startBatchImporting(active, at) : active
    if (active.kind === 'started') await deps.dailyMailImportBatchRepository.save(batch)
    await deps.eventBus.publish(
      MailImportResumedSchema.parse({
        ...domainEventBase(at),
        type: 'MailImportResumed',
        userId: params.userId,
        resumedAt: at,
      }),
    )
  }

  const outcomeBase = {
    importBatchId: batch.common.importBatchId,
    targetPeriod: batch.common.targetPeriod,
    resumed,
  }

  const fail = async (
    failureKind: DailyMailImportFailureKind,
    failureDetail: string,
    retryable: boolean,
  ): Promise<DailyMailImportOutcome> => {
    await deps.dailyMailImportBatchRepository.save(failBatch(batch, failureDetail, new Date()))
    return { ...outcomeBase, status: 'failed', failureKind, retryable, failureDetail }
  }

  const token = await deps.gmailOAuthTokenRepository.findByUserId(params.userId)
  if (token === null) {
    // 連携前 / 連携解除後。翌日も同じ結果になるので、待てば直る失敗ではない
    return fail('gmail_not_authorized', 'Gmail 連携が未設定のため取り込めない', false)
  }
  if (token.kind === 'revocation_detected') {
    // 再認可（#392 の導線）が済むまでは取得しても失敗する。無駄な API 呼び出しをしない
    return fail('gmail_not_authorized', 'Gmail 連携が失効しており再認可待ち', false)
  }

  const fetched = await deps.gmailMailFetchGateway.fetchMails({
    userId: params.userId,
    tokenStoreRef: token.tokenStoreRef,
    period: batch.common.targetPeriod,
  })
  if (!fetched.ok) {
    const { failure } = fetched
    const retryable = failure.kind === 'other_fetch_failure' && failure.retryable
    console.error(
      `[transaction-import] メール取得に失敗した（${batchLabel(batch)}, ` +
        `kind=${failure.kind}, retryable=${retryable}）— ${failure.detail}` +
        (failure.kind === 'oauth_revocation_detected'
          ? '。再認可されるまで取込は進まない'
          : '。翌日の再走査で取りこぼしを回収する'),
    )
    return fail(failureKindOf(failure), failure.detail, retryable)
  }

  await deps.eventBus.publish(
    MailFetchedSchema.parse({
      ...domainEventBase(at),
      type: 'MailFetched',
      importBatchId: batch.common.importBatchId,
      fetchedCount: fetched.smbcMails.length + fetched.amazonMails.length,
    }),
  )

  let importedCount = 0
  let duplicateExcludedCount = 0
  let failedCount = 0
  const deferredKinds = new Map<string, number>()
  const seenInBatch = new Set<GmailMessageId>()

  try {
    for (const mail of fetched.smbcMails) {
      if (await isDuplicate(deps, mail.gmailMessageId, seenInBatch)) {
        duplicateExcludedCount++
        await publishDuplicateExcluded(deps, mail.gmailMessageId, at)
        continue
      }
      seenInBatch.add(mail.gmailMessageId)

      const parsed = deps.parseSmbcNotificationMail({ mail, userId: params.userId, at })
      if (parsed.kind === 'parse_failure') {
        failedCount++
        await deps.eventBus.publish(
          MailParseFailedSchema.parse({
            ...domainEventBase(at),
            type: 'MailParseFailed',
            gmailMessageId: parsed.gmailMessageId,
            reason: parsed.reason,
          }),
        )
        continue
      }
      if (parsed.kind !== 'card_usage') {
        // 反映先が別コンテキストにある種別。捨てた件数が分かるよう種別ごとに数える
        deferredKinds.set(parsed.kind, (deferredKinds.get(parsed.kind) ?? 0) + 1)
        continue
      }

      const created = await createCardUsageCandidate(deps, parsed, at)
      if (created === 'duplicate') {
        duplicateExcludedCount++
        await publishDuplicateExcluded(deps, parsed.gmailMessageId, at)
        continue
      }
      importedCount++
      if (importedCount % PROGRESS_SAVE_INTERVAL === 0) {
        batch = updateBatchImportedCount(batch, importedCount)
        await deps.dailyMailImportBatchRepository.save(batch)
      }
    }
  } catch (e) {
    // 取得後の処理で落ちた場合。バッチを取込中のまま残すと二重起動防止のロックが解けないため、
    // 失敗として閉じる。既に作った候補は残るが、翌日の再走査では重複除外されるので増えない。
    // 例外そのものは出さない — DB ドライバの例外は文・パラメータに userId（= LINE userID）を抱える
    const failureKind = e instanceof Error ? e.name : 'unknown'
    console.error(
      `[transaction-import] メール取込の処理中に失敗した（${batchLabel(batch)}, ` +
        `error=${failureKind}, imported=${importedCount}）— 翌日の再走査で続きを取り込む`,
    )
    return fail('unexpected_error', `メール取込の処理に失敗した（${failureKind}）`, true)
  }

  const deferredCount = [...deferredKinds.values()].reduce((sum, count) => sum + count, 0)
  if (deferredCount > 0) {
    // 取り込まなかったことが記録に残るようにする（種別と件数のみ。本文・金額は出さない）
    console.info(
      `[transaction-import] 取引候補にしない種別のメールを ${deferredCount} 件読み飛ばした` +
        `（${batchLabel(batch)}, ` +
        `${[...deferredKinds].map(([kind, count]) => `${kind}=${count}`).join(', ')}）`,
    )
  }

  const completedAt = new Date()
  const completed = completeBatch(
    batch,
    { importedCount, duplicateExcludedCount, failedCount },
    completedAt,
  )
  await deps.dailyMailImportBatchRepository.save(completed)
  await deps.eventBus.publish(
    MailImportBatchCompletedSchema.parse({
      ...domainEventBase(completedAt),
      type: 'MailImportBatchCompleted',
      importBatchId: completed.common.importBatchId,
      importedCount,
      duplicateExcludedCount,
      failedCount,
    }),
  )

  return {
    ...outcomeBase,
    status: 'completed',
    importedCount,
    duplicateExcludedCount,
    failedCount,
    deferredCount,
  }
}

/** 保存済みの候補・同一バッチ内の既出、どちらの重複も Gmail message ID の一致で判定する */
async function isDuplicate(
  deps: DailyMailImportDeps,
  gmailMessageId: GmailMessageId,
  seenInBatch: ReadonlySet<GmailMessageId>,
): Promise<boolean> {
  if (seenInBatch.has(gmailMessageId)) return true
  return (await deps.transactionCandidateRepository.findByGmailMessageId(gmailMessageId)) !== null
}

async function publishDuplicateExcluded(
  deps: DailyMailImportDeps,
  gmailMessageId: GmailMessageId,
  at: Date,
): Promise<void> {
  await deps.eventBus.publish(
    DuplicateExcludedSchema.parse({
      ...domainEventBase(at),
      type: 'DuplicateExcluded',
      subject: { kind: 'gmail_message', gmailMessageId },
      basis: { kind: 'gmail_message_id', gmailMessageId },
    }),
  )
}

/**
 * カード利用通知から通常取引候補を作る（08a §2「カード利用通知から取引候補を生成する」）。
 *
 * 保存が一意制約違反になった場合は、確認と保存の間に別の実行が同じメールを取り込んだとき
 * （同時起動）。実際に候補は存在するので失敗ではなく重複として扱う。
 */
async function createCardUsageCandidate(
  deps: DailyMailImportDeps,
  parsed: Extract<SmbcMailParseResult, { kind: 'card_usage' }>,
  at: Date,
): Promise<'created' | 'duplicate'> {
  const candidate = TransactionCandidateSchema.parse({
    kind: 'normal',
    common: {
      transactionCandidateId: TransactionCandidateIdSchema.parse(newUlid()),
      userId: parsed.userId,
      importSource: { kind: 'email', gmailMessageId: parsed.gmailMessageId },
      merchantName: parsed.merchantName,
      amount: parsed.amount,
      occurredAt: parsed.occurredAt,
    },
  })
  try {
    await deps.transactionCandidateRepository.save(candidate)
  } catch (e) {
    if (e instanceof InvariantViolationError) {
      const concurrent = await deps.transactionCandidateRepository.findByGmailMessageId(
        parsed.gmailMessageId,
      )
      if (concurrent !== null) return 'duplicate'
    }
    throw e
  }
  await deps.eventBus.publish(
    TransactionCandidateExtractedSchema.parse({
      ...domainEventBase(at),
      type: 'TransactionCandidateExtracted',
      transactionCandidateId: candidate.common.transactionCandidateId,
      userId: parsed.userId,
      importSource: candidate.common.importSource,
    }),
  )
  return 'created'
}

/** 世帯一括取込のユーザー単位の結末 */
export type HouseholdMemberMailImportResult =
  | { role: UserRole; status: 'imported'; outcome: DailyMailImportOutcome }
  /** その役割のユーザーが未登録（オンボーディング前）。取込対象が存在しない */
  | { role: UserRole; status: 'not_registered' }
  /**
   * 取込の手続きそのものが落ちた（バッチ記録を残せなかった等）。理由はエラー種別だけを持つ
   * — 呼出し元が結果をログや通知へ載せても、DB エラーの内部情報が外へ出ないようにする
   */
  | { role: UserRole; status: 'failed'; failureKind: string }

export interface HouseholdDailyMailImportOutcome {
  results: HouseholdMemberMailImportResult[]
}

/**
 * 世帯の全ユーザー（Honey / Darling）のメール取込を実行する（日次バッチの本体）。
 *
 * 1 人の失敗で他方の取込を巻き込まない（片方だけ通知メールを取り込めない日ができるより、
 * 取り込める側は取り込むほうが被害が小さい）。失敗は握りつぶさず記録し、結果に残す。
 * 呼出し元（#416 のエントリポイント）は失敗を見て再実行・通報を判断する。
 */
export async function runDailyMailImportForHousehold(
  deps: HouseholdDailyMailImportDeps,
  params: { at?: Date; scanDays?: number } = {},
): Promise<HouseholdDailyMailImportOutcome> {
  const at = params.at ?? new Date()
  const results: HouseholdMemberMailImportResult[] = []

  for (const role of UserRoleSchema.options) {
    try {
      const user = await deps.appUserRepository.findByRole(role)
      if (user === null) {
        console.info(`[transaction-import] メール取込の対象がいないため飛ばした（role=${role}）`)
        results.push({ role, status: 'not_registered' })
        continue
      }
      const outcome = await runDailyMailImportForUser(deps, {
        userId: user.common.userId,
        at,
        ...(params.scanDays === undefined ? {} : { scanDays: params.scanDays }),
      })
      results.push({ role, status: 'imported', outcome })
    } catch (e) {
      const failureKind = e instanceof Error ? e.name : 'unknown'
      console.error(
        `[transaction-import] メール取込を開始できなかった（role=${role}, error=${failureKind}）— ` +
          '他ユーザーの取込は継続する',
      )
      results.push({ role, status: 'failed', failureKind })
    }
  }

  return { results }
}
