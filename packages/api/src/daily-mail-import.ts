/**
 * 日次メール取込ワーカー（08a §2「Gmail からメールを取得する」〜「カード利用通知から取引候補を生成する」）
 *
 * 三井住友カードの利用通知メールが届いたら、その内容を家計簿の「取引候補」として自動で溜める。
 * 起動済みのバッチ記録（`POST /api/imports/mail-batch` が作るもの）を、取得 → 重複除外 →
 * パース → 候補生成 → 完了 まで進めるのが本モジュールの責務で（Gmail 連携が無い人については
 * そもそも起動しない。OQ-57 / #488）、次の 2 つの起点から同じ形で呼べるようにまとめてある:
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
 * パースは注入する（`SmbcNotificationMailParser`。実装はドメインの `parseSmbcNotificationMail`）。
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
  DuplicationJudgmentSchema,
  GmailOauthRevocationDetectedSchema,
  TransactionCandidateExtractedSchema,
  TransactionCandidateIdSchema,
  TransactionCandidateSchema,
  UserRoleSchema,
  completeBatch,
  detectTokenRevocation,
  failBatch,
  resumeBatchImporting,
  startBatchImporting,
  updateBatchImportedCount,
} from '@warimaru/domain'
import type {
  AmazonOrderConfirmationMailParser,
  AppUserRepository,
  DailyMailImportBatch,
  DailyMailImportBatchRepository,
  DuplicationJudgment,
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
  ValidGmailOAuthToken,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { domainEventBase } from './event-handlers/index.js'
import { runAmazonOrderMatching, type AmazonOrderMatchSummary } from './amazon-order-match.js'

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
  /** SMBC 通知メール本文のパース（実装はドメインの `parseSmbcNotificationMail`） */
  parseSmbcNotificationMail: SmbcNotificationMailParser
  /** Amazon 注文確認メール本文のパース（実装はドメインの `parseAmazonOrderConfirmationMail`） */
  parseAmazonOrderConfirmationMail: AmazonOrderConfirmationMailParser
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
 *  - `oauth_revocation_detected`: 取得の途中でトークン失効を検知した（再認可導線 #392 の起点）
 *  - `other_fetch_failure`: 通信断・API 障害・設定不備などの取得失敗
 *  - `unexpected_error`: 取得後の処理（パース結果の保存など）で想定外の失敗が起きた
 *
 * 連携がそもそも無い場合はここに含めない。バッチを起動する前に弾いて `not_launched` として
 * 返すため、「起動したが失敗した」種別としては現れない（OQ-57 / #488）。
 */
export type DailyMailImportFailureKind =
  | 'oauth_revocation_detected'
  | 'other_fetch_failure'
  | 'unexpected_error'

/**
 * バッチを起動しなかった理由（08a `behavior 日次メール取込バッチを起動する` の事前条件
 * 「ユーザーが Gmail OAuth 連携を完了している」を満たさない状態）。
 *  - `not_linked`: 連携前・連携解除後（トークンが無い）
 *  - `revocation_detected`: 失効を検知済みで、再認可されるまで取り込めない
 */
export type DailyMailImportNotLaunchedReason = 'not_linked' | 'revocation_detected'

/**
 * 起動しなかった理由ごとの文言。ここに定義した固定文だけが結末に載る。
 *
 * この結末はそのまま手動実行の API 応答に入るため、文言を呼び出しの都度組み立てられる形
 * （任意の `string`）にしておくと、後からリポジトリや Gmail API のエラー文を流し込む変更が
 * 入ったときに内部情報が応答へ素通しになる。定数に閉じて型でも狭めておく。
 *
 * 状態の説明だけで終わらせず、次にとる行動まで含める（この結末を受け取った人にできるのは
 * 再実行ではなく Gmail の連携だけで、そこを書かないと「時間をおいて試す」に読まれる）。
 */
const NOT_LAUNCHED_DETAIL = {
  not_linked: 'Gmail 連携が未設定のため取り込めない。設定から Gmail を連携する',
  revocation_detected: 'Gmail 連携が失効しており取り込めない。設定から Gmail を連携し直す',
} as const satisfies Record<DailyMailImportNotLaunchedReason, string>

/**
 * 1 ユーザーぶんの取込結果。
 *
 * `not_launched` は「起動の事前条件を満たさないので始めなかった」結末で、失敗（起動したが
 * 取り込めなかった）とは別の層に置く。再認可されるまで何度実行しても結果は変わらないため、
 * 毎日の実行のたびに失敗記録を積み上げると、通信断や失効など本当に追うべき失敗が埋もれる
 * （OQ-57 / #488）。バッチ記録を残さないので `importBatchId` も持たない。
 *
 * `resumed` は、前回の実行が最後まで進まずに残していたバッチを引き継いだかを表す。
 * `otherNotificationCount` は、パースには成功したが取引候補にしない種別（銀行入金・引落確定
 * など。反映先が別コンテキスト）の件数で、`importedCount` にも `failedCount` にも入らない。
 * `duplicateExcludedCount` / `failedCount` はこの実行で数えたぶんだが、`importedCount` だけは
 * バッチに永続化される累計（再開時は引き継いだ件数から続けて数える）。
 */
export type DailyMailImportOutcome =
  | {
      status: 'not_launched'
      reason: DailyMailImportNotLaunchedReason
      /** ログ・応答に載る短い文言。`NOT_LAUNCHED_DETAIL` の固定文だけを取る */
      detail: (typeof NOT_LAUNCHED_DETAIL)[DailyMailImportNotLaunchedReason]
    }
  | ({
      importBatchId: ImportBatchId
      targetPeriod: ImportTargetPeriod
      resumed: boolean
    } & (
      | {
          status: 'completed'
          /** バッチに積み上がった取込済み件数（再開したときは前回ぶんを含む） */
          importedCount: number
          duplicateExcludedCount: number
          failedCount: number
          otherNotificationCount: number
          /** Amazon 注文確認メールの突合結果（08a §2）。この実行で数えたぶん */
          amazonMatch: AmazonOrderMatchSummary
        }
      | {
          status: 'failed'
          failureKind: DailyMailImportFailureKind
          /** 同じ実行をやり直せば結果が変わりうるか（翌日の再走査で回収できるか） */
          retryable: boolean
          /** ログ・応答に載る短い文言。シークレット・PII・メール本文を含めない */
          failureDetail: string
        }
    ))

/**
 * バッチを起動した実行の結末（`importBatchId` を必ず持つ）。
 * 「起動しなかった結末」が将来増えても参照側が追随しなくて済むよう、除外は一箇所に置く。
 */
export type LaunchedDailyMailImportOutcome = Exclude<
  DailyMailImportOutcome,
  { status: 'not_launched' }
>

/**
 * トークン失効を検知した事実を残す（08f §2「Gmail OAuth トークンの失効を検知する」）。
 *
 * 取得の失敗として記録するだけでは、トークンは有効なまま残り、再認可のコールバック
 * （`routes/gmail-oauth.ts` の失効検知済み分岐）も動かない。つまり連携が切れた翌日から
 * カード利用が家計簿に出てこない状態が、誰にも知らされないまま続く。ここで集約を
 * 失効検知済みへ移し、失効検知イベントを出して、個人 DM での再認可導線（#392）が
 * 購読できる起点にする。
 *
 * この記録に失敗しても取込の結末（取得失敗）は変えない。記録は次回の取込でやり直せる一方、
 * ここで例外を投げると失敗の理由が「取得できなかった」から実装エラーにすり替わる。
 */
async function recordTokenRevocation(
  deps: DailyMailImportDeps,
  token: ValidGmailOAuthToken,
  at: Date,
): Promise<void> {
  try {
    await deps.gmailOAuthTokenRepository.save(detectTokenRevocation(token, 'api_call_failure', at))
    await deps.eventBus.publish(
      GmailOauthRevocationDetectedSchema.parse({
        ...domainEventBase(at),
        type: 'GmailOauthRevocationDetected',
        userId: token.userId,
        detectedAt: at,
      }),
    )
  } catch (e) {
    console.error(
      '[transaction-import] Gmail トークンの失効検知を記録できなかった' +
        `（error=${e instanceof Error ? e.name : 'unknown'}）— 次回の取込で記録し直す`,
    )
  }
}

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
 *
 * Gmail 連携が無い / 失効検知済みのときは、そもそもバッチを起動しない（08a の事前条件
 * 「ユーザーが Gmail OAuth 連携を完了している」。OQ-57 / #488）。起動記録も失敗記録も
 * 残さず `not_launched` を返す。
 *
 * このとき、前回の実行が取込中のまま残したバッチがあれば**そのまま残す**（終端化しない）。
 * 連携が無いあいだはどのみち取り込めないのでロックが誰かを待たせることはなく、再認可され
 * れば次の実行がそのバッチを引き継いで、連携が切れた当時の対象期間を取り直す（失敗として
 * 閉じてしまうと、その期間は二度と走査されない）。連携チェックがバッチ照会より前にある
 * ため、残存バッチには触れずに返る。
 */
export async function runDailyMailImportForUser(
  deps: DailyMailImportDeps,
  params: DailyMailImportParams,
): Promise<DailyMailImportOutcome> {
  const at = params.at ?? new Date()
  // 期間の不変条件（from < to）をここで弾く。組み立てるだけで保存はしないため、この後の
  // 連携チェックで起動を見送っても記録は残らない（手動実行の不正な期間は 400 のまま）
  const launched = buildLaunchedBatch(params, at)

  const token = await deps.gmailOAuthTokenRepository.findByUserId(params.userId)
  if (token === null || token.kind === 'revocation_detected') {
    // 連携前・連携解除後・失効検知済みのいずれか。再認可されるまで何度実行しても取り込めない
    // ため、取得を試みないだけでなく起動記録も残さない（毎日 1 件ずつ失敗記録が積み上がると、
    // 通信断・失効など本当に追うべき失敗が埋もれる）。
    // 無言で終わらないよう対象外として結果に残し、呼出し元がログと成否に反映する
    // （毎日のバッチ全体の成否は #514 の決定どおり異常として扱う）
    if (token !== null) {
      // 失効検知済みのあいだは失効検知イベントを同じ検知日時で再発行する（at-least-once）。
      // 失効通知の個人 DM（#392）が失効時点の 1 回きりだと、その送信に失敗したとき再送の
      // 機会が二度と来ない — 検知イベントは失効の瞬間にしか出ず、以後の実行はここで返る。
      // 再発行なら通知側の冪等性キー（ユーザー × 検知日時）が配信済みを弾き、未達が確定した
      // 失敗（#441-A）だけが翌日の実行で送り直される。
      // 再発行に失敗してもこの実行の結末（対象外）は変えない（recordTokenRevocation と同じ
      // 方針。ここで例外を投げると対象外が実装エラーにすり替わる）。翌日の実行が再送機会になる
      try {
        await deps.eventBus.publish(
          GmailOauthRevocationDetectedSchema.parse({
            ...domainEventBase(at),
            type: 'GmailOauthRevocationDetected',
            userId: token.userId,
            detectedAt: token.revocationDetectedAt,
          }),
        )
      } catch (e) {
        console.warn(
          '[transaction-import] 失効検知イベントの再発行に失敗した' +
            `（error=${e instanceof Error ? e.name : 'unknown'}）— 翌日の実行で再発行される`,
        )
      }
    }
    const reason: DailyMailImportNotLaunchedReason =
      token === null ? 'not_linked' : 'revocation_detected'
    return { status: 'not_launched', reason, detail: NOT_LAUNCHED_DETAIL[reason] }
  }

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
    // （引き継ぎ先の期間で取り直すと、前回ぶんの取りこぼしが検索範囲から外れうる）。
    // 取込中からの引き継ぎでも取込開始日時は引き継いだ実行のものへ進めて保存する — この時刻が
    // 手動実行のクールダウンの起点（#489）で、前の実行の時刻のまま残すと、いま走っている
    // この実行の最中に叩き直された手動実行を止められない
    batch =
      active.kind === 'started' ? startBatchImporting(active, at) : resumeBatchImporting(active, at)
    await deps.dailyMailImportBatchRepository.save(batch)
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
    if (failure.kind === 'oauth_revocation_detected') {
      await recordTokenRevocation(deps, token, failure.detectedAt)
    }
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

  // 取込済み件数はバッチに積み上がる値なので、引き継いだバッチの件数から数え始める
  // （0 から数え直すと、完了時に前回ぶんを含まない件数で上書きしてしまう。集約は減る更新を禁じている）
  let importedCount = batch.importedCount
  let importedThisRun = 0
  let duplicateExcludedCount = 0
  let failedCount = 0
  const otherNotificationKinds = new Map<string, number>()
  const seenInBatch = new Set<GmailMessageId>()
  // 失敗したときにどのメールで落ちたかを残す（Gmail message ID は重複除外のため DB にも
  // 持つ識別子で PII ではない）
  let processing: GmailMessageId | undefined

  try {
    for (const mail of fetched.smbcMails) {
      processing = mail.gmailMessageId
      const judgment = await judgeDuplication(
        deps,
        params.userId,
        mail.gmailMessageId,
        seenInBatch,
        at,
      )
      if (judgment.kind !== 'not_duplicate') {
        duplicateExcludedCount++
        await publishDuplicateExcluded(deps, judgment, at)
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
        otherNotificationKinds.set(parsed.kind, (otherNotificationKinds.get(parsed.kind) ?? 0) + 1)
        continue
      }

      const created = await createCardUsageCandidate(deps, parsed, params.userId, at)
      if (created.kind === 'duplicate') {
        duplicateExcludedCount++
        await publishDuplicateExcluded(deps, created.judgment, at)
        continue
      }
      importedCount++
      importedThisRun++
      if (importedThisRun % PROGRESS_SAVE_INTERVAL === 0) {
        batch = updateBatchImportedCount(batch, importedCount)
        await deps.dailyMailImportBatchRepository.save(batch)
      }
    }
  } catch (e) {
    // 取得後の処理で落ちた場合。バッチを取込中のまま残すと二重起動防止のロックが解けないため、
    // 失敗として閉じる。既に作った候補は残るが、翌日の再走査では重複除外されるので増えない。
    // 例外そのものは出さない — DB ドライバの例外は文・パラメータに userId（= LINE userID）を抱える
    const failureKind = e instanceof Error ? e.name : 'unknown'
    // 不変条件違反はやり直しても直らない実装の誤り。一時障害と同じ `retryable` で記録すると
    // 「待てば直る」として誰も追わなくなる
    const retryable = !(e instanceof InvariantViolationError)
    console.error(
      `[transaction-import] メール取込の処理中に失敗した（${batchLabel(batch)}, ` +
        `error=${failureKind}, retryable=${retryable}, imported=${importedCount}, ` +
        `gmailMessageId=${processing ?? 'unknown'}）— ` +
        (retryable ? '翌日の再走査で続きを取り込む' : '実装の誤りのため再実行では回復しない'),
    )
    // 失敗の詳細は呼出し元（API 応答を含む）へ渡るため、例外の種別名は載せずログだけに残す
    // （DB ドライバの例外クラス名は内部構成の手がかりになる）
    return fail('unexpected_error', 'メール取込の処理に失敗した', retryable)
  }

  const otherNotificationCount = [...otherNotificationKinds.values()].reduce(
    (sum, count) => sum + count,
    0,
  )
  if (otherNotificationCount > 0) {
    // 取り込まなかったことが記録に残るようにする（種別と件数のみ。本文・金額は出さない）
    console.info(
      `[transaction-import] 取引候補にしない種別のメールを ${otherNotificationCount} 件読み飛ばした` +
        `（${batchLabel(batch)}, ` +
        `${[...otherNotificationKinds].map(([kind, count]) => `${kind}=${count}`).join(', ')}）`,
    )
  }

  if (failedCount > 0) {
    // 取り込めなかったメールがあることを、バッチ記録を引かずに気づけるようにする
    console.info(
      `[transaction-import] 取り込めなかったメールがある（${batchLabel(batch)}, ` +
        `パース失敗=${failedCount}）`,
    )
  }

  // Amazon 注文確認メールの突合はカード利用通知の取込のあとに行う。順番が逆だと、この実行で
  // 取り込んだ候補が突合の相手に入らない（記録と結末は amazon-order-match.ts が持つ）。
  // 注文確認メールが 0 通でも呼ぶ — 注文が届かないまま期限を過ぎた候補の未分類確定
  // （SMBC 先着タイムアウト）は、この実行で Amazon のメールが無くても進める必要がある
  let amazonMatch: AmazonOrderMatchSummary
  try {
    amazonMatch = await runAmazonOrderMatching(deps, {
      userId: params.userId,
      amazonMails: fetched.amazonMails,
      targetPeriod: batch.common.targetPeriod,
      importBatchId: batch.common.importBatchId,
      at,
    })
  } catch (e) {
    // カード利用通知の取込と同じ扱いで、バッチを取込中のまま残さず失敗として閉じる
    // （残すと二重起動防止のロックが解けない）。保存済みの候補はそのまま残り、翌日の
    // 再走査で突合をやり直せる（突合していない候補は通常のまま残っているため）
    const failureKind = e instanceof Error ? e.name : 'unknown'
    const retryable = !(e instanceof InvariantViolationError)
    console.error(
      `[transaction-import] Amazon 注文の突合中に失敗した（${batchLabel(batch)}, ` +
        `error=${failureKind}, retryable=${retryable}）— ` +
        (retryable ? '翌日の再走査でやり直す' : '実装の誤りのため再実行では回復しない'),
    )
    return fail('unexpected_error', 'Amazon 注文の突合に失敗した', retryable)
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
    otherNotificationCount,
    amazonMatch,
  }
}

/**
 * メールの重複を判定する（08a §2「メールの重複を判定する」）。
 *
 * 保存済みの候補との一致と、同一バッチ内で同じメールが 2 度返った場合の一致を、どちらも
 * Gmail message ID で見る。保存済み候補の照合は取込対象の利用者に閉じる（#487。Gmail
 * message ID はアカウント間の一意性を保証しないため、相手の同番号メールを重複と誤判定しない）。
 * 既存候補が判明した場合は判定結果にその候補 ID を載せる
 * （重複除外イベントの主体を「どのメールか」ではなく「どの候補と重なったか」で残せる）。
 */
async function judgeDuplication(
  deps: DailyMailImportDeps,
  userId: UserId,
  gmailMessageId: GmailMessageId,
  seenInBatch: ReadonlySet<GmailMessageId>,
  at: Date,
): Promise<DuplicationJudgment | { kind: 'in_batch_duplicate'; gmailMessageId: GmailMessageId }> {
  if (seenInBatch.has(gmailMessageId)) return { kind: 'in_batch_duplicate', gmailMessageId }
  const existing = await deps.transactionCandidateRepository.findByGmailMessageId(
    userId,
    gmailMessageId,
  )
  return DuplicationJudgmentSchema.parse(
    existing === null
      ? { kind: 'not_duplicate', detectedAt: at }
      : {
          kind: 'duplicate',
          existingCandidateId: existing.common.transactionCandidateId,
          basis: { kind: 'gmail_message_id', gmailMessageId },
          detectedAt: at,
        },
  )
}

/**
 * 重複除外イベントを発行する。既存候補が分かっているときはその候補 ID を、同一バッチ内の
 * 重複（まだ候補が無い）ときは Gmail message ID を主体にする。
 */
async function publishDuplicateExcluded(
  deps: DailyMailImportDeps,
  judgment: DuplicateJudgmentForExclusion,
  at: Date,
): Promise<void> {
  const gmailMessageId =
    judgment.kind === 'in_batch_duplicate' ? judgment.gmailMessageId : gmailMessageIdOf(judgment)
  await deps.eventBus.publish(
    DuplicateExcludedSchema.parse({
      ...domainEventBase(at),
      type: 'DuplicateExcluded',
      subject:
        judgment.kind === 'in_batch_duplicate'
          ? { kind: 'gmail_message', gmailMessageId }
          : { kind: 'candidate', transactionCandidateId: judgment.existingCandidateId },
      basis: { kind: 'gmail_message_id', gmailMessageId },
    }),
  )
}

/** 重複除外の対象になりうる判定（保存済み候補との重複 / 同一バッチ内の重複） */
type DuplicateJudgmentForExclusion =
  | Extract<DuplicationJudgment, { kind: 'duplicate' }>
  | { kind: 'in_batch_duplicate'; gmailMessageId: GmailMessageId }

function gmailMessageIdOf(
  judgment: Extract<DuplicationJudgment, { kind: 'duplicate' }>,
): GmailMessageId {
  // 本ワーカーが作る判定の根拠は常に Gmail message ID 一致（三項一致は CSV / PDF 取込の経路）
  if (judgment.basis.kind !== 'gmail_message_id') {
    throw new InvariantViolationError(
      'メール取込の重複判定の根拠は Gmail message ID でなければならない',
    )
  }
  return judgment.basis.gmailMessageId
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
  userId: UserId,
  at: Date,
): Promise<{ kind: 'created' } | { kind: 'duplicate'; judgment: DuplicateJudgmentForExclusion }> {
  if (parsed.userId !== userId) {
    // 持ち主はバッチが決める。パース結果はメール本文（外部入力）から作られるため、そこに
    // 現れたユーザーを信じると相手の明細が本人の候補として保存されうる
    throw new InvariantViolationError('パース結果の持ち主が取込対象のユーザーと一致しない')
  }
  const candidate = TransactionCandidateSchema.parse({
    kind: 'normal',
    common: {
      transactionCandidateId: TransactionCandidateIdSchema.parse(newUlid()),
      userId,
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
        userId,
        parsed.gmailMessageId,
      )
      if (concurrent !== null) {
        return {
          kind: 'duplicate',
          judgment: {
            kind: 'duplicate',
            existingCandidateId: concurrent.common.transactionCandidateId,
            basis: { kind: 'gmail_message_id', gmailMessageId: parsed.gmailMessageId },
            detectedAt: at,
          },
        }
      }
    }
    throw e
  }
  await deps.eventBus.publish(
    TransactionCandidateExtractedSchema.parse({
      ...domainEventBase(at),
      type: 'TransactionCandidateExtracted',
      transactionCandidateId: candidate.common.transactionCandidateId,
      userId,
      importSource: candidate.common.importSource,
    }),
  )
  return { kind: 'created' }
}

/** 世帯一括取込のユーザー単位の結末 */
export type HouseholdMemberMailImportResult =
  | { role: UserRole; status: 'imported'; outcome: LaunchedDailyMailImportOutcome }
  /** その役割のユーザーが未登録（オンボーディング前）。取込対象が存在しない */
  | { role: UserRole; status: 'not_registered' }
  /**
   * Gmail 連携が無いため取込を起動しなかった（対象外）。未登録と同じ「取込を始めなかった」層で、
   * 失敗（起動したが取り込めなかった）とは区別する。再認可されるまで結果は変わらないため、
   * 呼出し元は失敗記録の積み上げではなく状態として扱う（OQ-57 / #488）。
   * ただし取り込めない日が続く事実には気づける必要があるため、毎日のバッチ全体の成否では
   * 引き続き異常として扱う（#514）
   */
  | { role: UserRole; status: 'not_launched'; reason: DailyMailImportNotLaunchedReason }
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
      if (outcome.status === 'not_launched') {
        // 未連携（もともと取り込んでいない定常状態）と失効（昨日まで取り込めていたものが
        // 今日から止まっている）は運用上の重さが違うので、文言と深刻度を分ける。
        // ログはここでだけ出す — ワーカーは role を知らず、userId は PII で出せないため、
        // 世帯の 2 人ぶんが見分けの付かない同じ 1 行になる
        const message =
          `[transaction-import] Gmail 連携が${outcome.reason === 'not_linked' ? '未設定' : '失効している'}ため` +
          `メール取込を起動しなかった（role=${role}, reason=${outcome.reason}）`
        if (outcome.reason === 'not_linked') console.warn(message)
        else console.error(message)
        results.push({ role, status: 'not_launched', reason: outcome.reason })
        continue
      }
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
