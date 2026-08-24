/**
 * 日次メール取込ワーカー（#414。08a §2 の取得 → 重複除外 → パース → 候補生成）のテスト。
 *
 * 起動はスケジューラ（#416 の Lambda エントリポイント）と手動 API の 2 経路だが、進行そのものは
 * ワーカーが持つため、ルートを介さず直接呼んで固定する。Gmail 取得（driven port）とパース関数は
 * 注入して、取得結果・パース結果の組み合わせごとの結末を検証する。
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  DailyMailImportBatchSchema,
  GmailMessageIdSchema,
  GmailOAuthTokenSchema,
  InvariantViolationError,
  ParameterStorePathSchema,
  SmbcMailParseResultSchema,
  money,
  registerAppUser,
} from '@warimaru/domain'
import type {
  AmazonOrderConfirmationMailBody,
  DailyMailImportBatch,
  DomainEvent,
  DuplicateExcluded,
  GmailOauthRevocationDetected,
  GmailMailFetchGateway,
  GmailMessageId,
  MailFetched,
  MailFetchRequest,
  MailFetchResult,
  MailImportBatchCompleted,
  MailImportBatchLaunched,
  MailImportResumed,
  MailParseFailed,
  SmbcNotificationMailBody,
  SmbcNotificationMailParser,
  TransactionCandidate,
  TransactionCandidateExtracted,
  UserId,
} from '@warimaru/domain'
import {
  DEFAULT_MAIL_SCAN_DAYS,
  runDailyMailImportForHousehold,
  runDailyMailImportForUser,
  type DailyMailImportDeps,
  type DailyMailImportNotLaunchedReason,
  type DailyMailImportOutcome,
  type LaunchedDailyMailImportOutcome,
} from '../src/daily-mail-import.js'
import { createTestApp, SPOUSE_ID, VIEWER_ID, type TestApp } from './helpers/test-app.js'

const AT = new Date('2026-07-10T00:00:00+09:00')
const OCCURRED_AT = new Date('2026-07-09T12:34:00+09:00')
const LEFTOVER_BATCH_ID = '01BATCH0000000000000000000'

afterEach(() => {
  vi.restoreAllMocks()
})

/** 前回の実行が取込中のまま残したバッチ（引き継ぎの検証用） */
function leftoverImporting(importedCount: number) {
  return DailyMailImportBatchSchema.parse({
    kind: 'importing',
    common: {
      importBatchId: LEFTOVER_BATCH_ID,
      userId: VIEWER_ID,
      launchedAt: new Date('2026-07-09T00:00:00+09:00'),
      targetPeriod: {
        from: new Date('2026-07-04T00:00:00+09:00'),
        to: new Date('2026-07-09T00:00:00+09:00'),
      },
    },
    importStartedAt: new Date('2026-07-09T00:00:00+09:00'),
    importedCount,
  })
}

function mailBody(id: string, overrides: Partial<SmbcNotificationMailBody> = {}) {
  return {
    gmailMessageId: GmailMessageIdSchema.parse(id),
    receivedAt: OCCURRED_AT,
    subject: 'ご利用のお知らせ【三井住友カード】',
    body: '本文',
    kindHint: 'card_usage' as const,
    ...overrides,
  }
}

/** 常に「取得成功」を返す Gmail 取得。呼び出し内容も検証できるよう記録する */
function fetchGatewayReturning(
  smbcMails: SmbcNotificationMailBody[],
  amazonMails: AmazonOrderConfirmationMailBody[] = [],
): GmailMailFetchGateway & { requests: MailFetchRequest[] } {
  const requests: MailFetchRequest[] = []
  return {
    requests,
    fetchMails: (request: MailFetchRequest): Promise<MailFetchResult> => {
      requests.push(request)
      return Promise.resolve({ ok: true, smbcMails, amazonMails })
    },
  }
}

function fetchGatewayFailing(failure: MailFetchResult): GmailMailFetchGateway {
  return { fetchMails: () => Promise.resolve(failure) }
}

/** カード利用としてパースするスタブ（実パースルールは #415） */
function cardUsageParser(merchantName = 'スーパーA', amount = 1200): SmbcNotificationMailParser {
  return ({ mail, userId }) =>
    SmbcMailParseResultSchema.parse({
      kind: 'card_usage',
      gmailMessageId: mail.gmailMessageId,
      userId,
      merchantName,
      amount: money(amount),
      occurredAt: OCCURRED_AT,
      cardKind: 'mitsui_sumitomo',
    })
}

function parseFailureParser(
  reason:
    | 'structure_mismatch'
    | 'missing_required_field'
    | 'garbled_text'
    | 'other' = 'garbled_text',
): SmbcNotificationMailParser {
  return ({ mail, at }) =>
    SmbcMailParseResultSchema.parse({
      kind: 'parse_failure',
      gmailMessageId: mail.gmailMessageId,
      reason,
      detectedAt: at,
    })
}

/** 銀行入金としてパースするスタブ（本 Issue では取引候補にしない種別） */
function bankDepositParser(): SmbcNotificationMailParser {
  return ({ mail, userId }) =>
    SmbcMailParseResultSchema.parse({
      kind: 'bank_deposit',
      gmailMessageId: mail.gmailMessageId,
      userId,
      payerName: 'カ）ドコカノカイシャ',
      amount: money(250000),
      occurredAt: OCCURRED_AT,
    })
}

interface Harness {
  t: TestApp
  deps: DailyMailImportDeps
  gateway: GmailMailFetchGateway & { requests: MailFetchRequest[] }
}

async function harness(
  options: {
    mails?: SmbcNotificationMailBody[]
    parser?: SmbcNotificationMailParser
    userId?: UserId
    authorized?: boolean
  } = {},
): Promise<Harness> {
  const t = createTestApp()
  const userId = options.userId ?? VIEWER_ID
  if (options.authorized !== false) await authorize(t, userId)
  const gateway = fetchGatewayReturning(options.mails ?? [mailBody('gmail-1')])
  return {
    t,
    gateway,
    deps: {
      ...t.deps,
      gmailMailFetchGateway: gateway,
      parseSmbcNotificationMail: options.parser ?? cardUsageParser(),
    },
  }
}

async function authorize(t: TestApp, userId: UserId): Promise<void> {
  await t.deps.gmailOAuthTokenRepository.save(
    GmailOAuthTokenSchema.parse({
      kind: 'valid',
      userId,
      tokenStoreRef: ParameterStorePathSchema.parse(`/warimaru/gmail/${userId}`),
      authorizedAt: AT,
      lastVerifiedAt: AT,
    }),
  )
}

/** Gmail 連携が失効検知済みの状態にする（再認可されるまで取り込めない） */
async function revokeToken(t: TestApp, userId: UserId = VIEWER_ID): Promise<void> {
  await t.deps.gmailOAuthTokenRepository.save(
    GmailOAuthTokenSchema.parse({
      kind: 'revocation_detected',
      userId,
      tokenStoreRef: ParameterStorePathSchema.parse(`/warimaru/gmail/${userId}`),
      authorizedAt: AT,
      revocationDetectedAt: AT,
      revocationReason: 'expired',
    }),
  )
}

async function savedCandidates(t: TestApp, ids: string[]): Promise<TransactionCandidate[]> {
  const found = await Promise.all(
    ids.map(id =>
      t.deps.transactionCandidateRepository.findByGmailMessageId(
        VIEWER_ID,
        GmailMessageIdSchema.parse(id),
      ),
    ),
  )
  return found.filter((c): c is TransactionCandidate => c !== null)
}

/**
 * バッチを起動した結末に絞る（起動しなかった結末は `importBatchId` を持たない）。
 * 起動していなければその場で落として、後続の検証が黙って素通りしないようにする。
 */
function launched(outcome: DailyMailImportOutcome): LaunchedDailyMailImportOutcome {
  if (outcome.status === 'not_launched') {
    throw new Error(`バッチが起動されなかった（reason=${outcome.reason}）`)
  }
  return outcome
}

function collect<E extends DomainEvent>(t: TestApp, type: E['type']): E[] {
  const log: E[] = []
  t.deps.eventBus.subscribe<E>(type, e => {
    log.push(e)
  })
  return log
}

describe('日次メール取込ワーカー: 取得 → パース → 候補生成 → 完了', () => {
  it('カード利用通知から取引候補が生成され、完了までの状態遷移とイベントが記録される', async () => {
    const { t, deps } = await harness({ mails: [mailBody('gmail-1')] })
    const extracted = collect<TransactionCandidateExtracted>(t, 'TransactionCandidateExtracted')
    const completedEvents = collect<MailImportBatchCompleted>(t, 'MailImportBatchCompleted')

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome.status).toBe('completed')
    expect(outcome).toMatchObject({
      status: 'completed',
      importedCount: 1,
      duplicateExcludedCount: 0,
      failedCount: 0,
      resumed: false,
    })

    const [candidate] = await savedCandidates(t, ['gmail-1'])
    expect(candidate?.kind).toBe('normal')
    expect(candidate?.common.merchantName).toBe('スーパーA')
    expect(candidate?.common.amount).toBe(1200)
    expect(candidate?.common.importSource).toEqual({
      kind: 'email',
      gmailMessageId: 'gmail-1',
    })

    const batch = await t.deps.dailyMailImportBatchRepository.findById(
      launched(outcome).importBatchId,
    )
    expect(batch?.kind).toBe('completed')
    expect(extracted).toHaveLength(1)
    expect(completedEvents[0]?.importedCount).toBe(1)
  })

  it('取込対象期間は既定で過去 5 日ぶん（OQ-31）で、scanDays で調整できる', async () => {
    const { deps, gateway } = await harness()
    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })
    const defaultPeriod = gateway.requests[0]?.period
    expect(defaultPeriod?.to).toEqual(AT)
    // 既定は 5 日（OQ-31）。期待値は実装と同じ式ではなくリテラルで固定する
    expect(defaultPeriod?.from).toEqual(new Date('2026-07-05T00:00:00+09:00'))
    expect(DEFAULT_MAIL_SCAN_DAYS).toBe(5)

    const later = new Date('2026-07-11T00:00:00+09:00')
    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: later, scanDays: 1 })
    expect(gateway.requests[1]?.period.from).toEqual(new Date('2026-07-10T00:00:00+09:00'))
  })

  it('取込対象期間が逆転していたら起動しない（不変条件はドメインが単一ソース）', async () => {
    const { t, deps } = await harness()
    await expect(
      runDailyMailImportForUser(deps, {
        userId: VIEWER_ID,
        at: AT,
        period: { from: AT, to: new Date(AT.getTime() - 1000) },
      }),
    ).rejects.toThrow()
    // バッチ記録も作られない（進行中バッチの照会より前に弾く）
    expect(await t.deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)).toBeNull()
  })

  it('取得件数のイベントには Amazon 注文確認メールも数える', async () => {
    const t = createTestApp()
    await authorize(t, VIEWER_ID)
    const fetchedEvents = collect<MailFetched>(t, 'MailFetched')
    const gateway = fetchGatewayReturning(
      [mailBody('gmail-1'), mailBody('gmail-2')],
      [
        {
          gmailMessageId: GmailMessageIdSchema.parse('gmail-amazon-1'),
          receivedAt: OCCURRED_AT,
          subject: 'Amazon.co.jp ご注文の確認',
          body: '本文',
        },
      ],
    )

    await runDailyMailImportForUser(
      { ...t.deps, gmailMailFetchGateway: gateway, parseSmbcNotificationMail: cardUsageParser() },
      { userId: VIEWER_ID, at: AT },
    )

    expect(fetchedEvents[0]?.fetchedCount).toBe(3)
  })

  it('取得したメールの持ち主のトークン保管先で Gmail を読む', async () => {
    const { deps, gateway } = await harness()
    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })
    expect(gateway.requests[0]?.userId).toBe(VIEWER_ID)
    expect(gateway.requests[0]?.tokenStoreRef).toBe(`/warimaru/gmail/${VIEWER_ID}`)
  })
})

describe('日次メール取込ワーカー: Gmail message ID による重複除外', () => {
  it('既に取り込んだメールを再取得しても取引候補は増えない（過去 5 日の再走査）', async () => {
    const { t, deps } = await harness({ mails: [mailBody('gmail-1')] })
    const extracted = collect<TransactionCandidateExtracted>(t, 'TransactionCandidateExtracted')
    const duplicates = collect<DuplicateExcluded>(t, 'DuplicateExcluded')

    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })
    const second = await runDailyMailImportForUser(deps, {
      userId: VIEWER_ID,
      at: new Date(AT.getTime() + 24 * 60 * 60 * 1000),
    })

    expect(second).toMatchObject({
      status: 'completed',
      importedCount: 0,
      duplicateExcludedCount: 1,
    })
    // 生成された候補は 1 件のまま（2 度目は保存されていない）
    expect(extracted).toHaveLength(1)
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]?.basis).toEqual({ kind: 'gmail_message_id', gmailMessageId: 'gmail-1' })
    // 既に候補があると分かっている重複は、どの候補と重なったかを主体に残す
    const [existing] = await savedCandidates(t, ['gmail-1'])
    expect(duplicates[0]?.subject).toEqual({
      kind: 'candidate',
      transactionCandidateId: existing?.common.transactionCandidateId,
    })
  })

  it('同一バッチ内で同じメールが 2 通返っても取引候補は 1 件だけ', async () => {
    const { t, deps } = await harness({ mails: [mailBody('gmail-1'), mailBody('gmail-1')] })
    const extracted = collect<TransactionCandidateExtracted>(t, 'TransactionCandidateExtracted')

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome).toMatchObject({ importedCount: 1, duplicateExcludedCount: 1 })
    expect(extracted).toHaveLength(1)
  })

  it('確認と保存の間に別実行が同じ候補を作った場合（一意制約違反）は重複として扱う', async () => {
    const { t, deps } = await harness({ mails: [mailBody('gmail-1')] })
    const existing = await (async () => {
      // 先に別実行が保存した状態を作る（保存だけ失敗させ、照会では見つかるようにする）
      const repository = t.deps.transactionCandidateRepository
      const original = repository.save.bind(repository)
      let saved = false
      vi.spyOn(repository, 'save').mockImplementation(async candidate => {
        if (!saved) {
          saved = true
          await original(candidate)
          throw new InvariantViolationError('gmail_message_id が重複している')
        }
        await original(candidate)
      })
      return repository
    })()

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome).toMatchObject({
      status: 'completed',
      importedCount: 0,
      duplicateExcludedCount: 1,
    })
    expect(
      await existing.findByGmailMessageId(VIEWER_ID, GmailMessageIdSchema.parse('gmail-1')),
    ).not.toBeNull()
    vi.restoreAllMocks()
  })
})

describe('日次メール取込ワーカー: パース結果の扱い', () => {
  it('パース失敗は MailParseFailed として記録され、取引候補は作られない', async () => {
    const { t, deps } = await harness({
      mails: [mailBody('gmail-1')],
      parser: parseFailureParser('garbled_text'),
    })
    const failures = collect<MailParseFailed>(t, 'MailParseFailed')

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome).toMatchObject({ status: 'completed', importedCount: 0, failedCount: 1 })
    expect(failures[0]).toMatchObject({ gmailMessageId: 'gmail-1', reason: 'garbled_text' })
    expect(await savedCandidates(t, ['gmail-1'])).toHaveLength(0)
  })

  it('カード利用以外の通知（銀行入金）は取引候補にせず、失敗にも数えない', async () => {
    const { t, deps } = await harness({
      mails: [mailBody('gmail-1', { kindHint: 'bank_deposit' })],
      parser: bankDepositParser(),
    })

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome).toMatchObject({
      status: 'completed',
      importedCount: 0,
      failedCount: 0,
      duplicateExcludedCount: 0,
      otherNotificationCount: 1,
    })
    expect(await savedCandidates(t, ['gmail-1'])).toHaveLength(0)
  })
})

describe('日次メール取込ワーカー: 取得できないときの結末', () => {
  it('Gmail 未連携なら取得を試みず、対象外として返す', async () => {
    const t = createTestApp()
    const gateway = fetchGatewayReturning([mailBody('gmail-1')])
    const deps: DailyMailImportDeps = {
      ...t.deps,
      gmailMailFetchGateway: gateway,
      parseSmbcNotificationMail: cardUsageParser(),
    }

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome).toMatchObject({ status: 'not_launched', reason: 'not_linked' })
    expect(gateway.requests).toHaveLength(0)
  })

  const notLaunchedCases: {
    label: string
    reason: DailyMailImportNotLaunchedReason
    setup: (t: TestApp) => Promise<void>
  }[] = [
    { label: '未連携', reason: 'not_linked', setup: () => Promise.resolve() },
    { label: '失効検知済み', reason: 'revocation_detected', setup: t => revokeToken(t) },
  ]

  it.each(notLaunchedCases)(
    'Gmail $label ならバッチ起動の記録も起動イベントも残さない（reason=$reason）',
    async ({ reason, setup }) => {
      // 再認可されるまで結果は変わらないため、毎日の実行のたびに記録が積み上がると
      // 通信断・失効など本当に追うべき失敗が埋もれる（OQ-57 / #488）
      const t = createTestApp()
      await setup(t)
      const save = vi.spyOn(t.deps.dailyMailImportBatchRepository, 'save')
      const launchedEvents = collect<MailImportBatchLaunched>(t, 'MailImportBatchLaunched')
      const deps: DailyMailImportDeps = {
        ...t.deps,
        gmailMailFetchGateway: fetchGatewayReturning([mailBody('gmail-1')]),
        parseSmbcNotificationMail: cardUsageParser(),
      }

      const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

      expect(outcome).toMatchObject({ status: 'not_launched', reason })
      expect(save).not.toHaveBeenCalled()
      expect(launchedEvents).toHaveLength(0)
    },
  )

  it('失効検知済みのトークンでは取得を試みない（再認可待ち）', async () => {
    const t = createTestApp()
    await revokeToken(t)
    const gateway = fetchGatewayReturning([mailBody('gmail-1')])

    const outcome = await runDailyMailImportForUser(
      { ...t.deps, gmailMailFetchGateway: gateway, parseSmbcNotificationMail: cardUsageParser() },
      { userId: VIEWER_ID, at: AT },
    )

    expect(outcome).toMatchObject({ status: 'not_launched', reason: 'revocation_detected' })
    expect(gateway.requests).toHaveLength(0)
  })

  it('連携が切れたとき、残っている取込中バッチは終端化せずそのまま残す', async () => {
    // 失敗として閉じてしまうと、そのバッチが持っていた対象期間（連携が切れた当時の窓）は
    // 二度と走査されない。連携が無いあいだは誰もこのロックを待っていないので、再認可後の
    // 再開で引き継げるように残す
    const t = createTestApp()
    await revokeToken(t)
    await t.deps.dailyMailImportBatchRepository.save(leftoverImporting(3))

    const outcome = await runDailyMailImportForUser(
      {
        ...t.deps,
        gmailMailFetchGateway: fetchGatewayReturning([mailBody('gmail-1')]),
        parseSmbcNotificationMail: cardUsageParser(),
      },
      { userId: VIEWER_ID, at: AT },
    )

    expect(outcome).toMatchObject({ status: 'not_launched', reason: 'revocation_detected' })
    const leftover = await t.deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)
    expect(leftover).toMatchObject({ kind: 'importing', importedCount: 3 })
  })

  it('再認可すると、残っていた取込中バッチを当時の対象期間で引き継ぐ', async () => {
    const t = createTestApp()
    await revokeToken(t)
    const leftover = leftoverImporting(0)
    await t.deps.dailyMailImportBatchRepository.save(leftover)
    const gateway = fetchGatewayReturning([mailBody('gmail-1')])
    const deps: DailyMailImportDeps = {
      ...t.deps,
      gmailMailFetchGateway: gateway,
      parseSmbcNotificationMail: cardUsageParser(),
    }
    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    await authorize(t, VIEWER_ID)
    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(launched(outcome)).toMatchObject({ status: 'completed', resumed: true })
    expect(launched(outcome).importBatchId).toBe(LEFTOVER_BATCH_ID)
    expect(gateway.requests[0]?.period).toEqual(leftover.common.targetPeriod)
  })

  it('トークン失効の検知は、その他の取得失敗と区別して記録する', async () => {
    const t = createTestApp()
    await authorize(t, VIEWER_ID)

    const outcome = await runDailyMailImportForUser(
      {
        ...t.deps,
        gmailMailFetchGateway: fetchGatewayFailing({
          ok: false,
          failure: {
            kind: 'oauth_revocation_detected',
            detail: 'Gmail API が認可を拒否した（401）',
            detectedAt: AT,
          },
        }),
        parseSmbcNotificationMail: cardUsageParser(),
      },
      { userId: VIEWER_ID, at: AT },
    )

    expect(outcome).toMatchObject({
      status: 'failed',
      failureKind: 'oauth_revocation_detected',
      retryable: false,
    })
  })

  it('一時的な取得失敗は「やり直せば直りうる」として記録する', async () => {
    const t = createTestApp()
    await authorize(t, VIEWER_ID)

    const outcome = await runDailyMailImportForUser(
      {
        ...t.deps,
        gmailMailFetchGateway: fetchGatewayFailing({
          ok: false,
          failure: {
            kind: 'other_fetch_failure',
            detail: 'Gmail API がタイムアウトした（list）',
            detectedAt: AT,
            retryable: true,
          },
        }),
        parseSmbcNotificationMail: cardUsageParser(),
      },
      { userId: VIEWER_ID, at: AT },
    )

    expect(outcome).toMatchObject({
      status: 'failed',
      failureKind: 'other_fetch_failure',
      retryable: true,
    })
    // 起動したバッチは終端（failed）に落ちる。取込中のまま残すとロックが解けない
    const batch = await t.deps.dailyMailImportBatchRepository.findById(
      launched(outcome).importBatchId,
    )
    expect(batch).toMatchObject({ kind: 'failed' })
    expect(await t.deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)).toBeNull()
  })

  it('取得後の処理で落ちてもバッチは失敗として閉じる（取込中のまま残さない）', async () => {
    const { t, deps } = await harness({ mails: [mailBody('gmail-1')] })
    vi.spyOn(t.deps.transactionCandidateRepository, 'save').mockRejectedValue(
      new Error('database unavailable'),
    )

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'unexpected_error' })
    expect(await t.deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)).toBeNull()
  })
})

describe('日次メール取込ワーカー: 途中で終わった取込の再開', () => {
  it('残っている取込中バッチを引き継ぎ、MailImportResumed を発行する', async () => {
    const { t, deps, gateway } = await harness({ mails: [mailBody('gmail-1')] })
    const resumedEvents = collect<MailImportResumed>(t, 'MailImportResumed')
    const leftover = leftoverImporting(0)
    await t.deps.dailyMailImportBatchRepository.save(leftover)

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(launched(outcome).resumed).toBe(true)
    expect(launched(outcome).importBatchId).toBe(LEFTOVER_BATCH_ID)
    // 引き継いだバッチが起動時に決めた期間で取り直す（前回の取りこぼしを検索範囲から外さない）
    expect(gateway.requests[0]?.period).toEqual(leftover.common.targetPeriod)
    expect(resumedEvents).toHaveLength(1)
    expect(resumedEvents[0]?.userId).toBe(VIEWER_ID)
  })

  it('完了済みバッチのあとに再実行しても取引候補は増えない（再実行が冪等）', async () => {
    const { t, deps } = await harness({ mails: [mailBody('gmail-1')] })
    const first = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })
    const second = await runDailyMailImportForUser(deps, {
      userId: VIEWER_ID,
      at: new Date(AT.getTime() + 60_000),
    })

    expect(launched(first).importBatchId).not.toBe(launched(second).importBatchId)
    expect(second).toMatchObject({ status: 'completed', importedCount: 0, resumed: false })
    expect(await savedCandidates(t, ['gmail-1'])).toHaveLength(1)
  })

  it('引き継いだら取込開始日時を自分の時刻へ進めて保存する（手動実行のクールダウンの起点）', async () => {
    // 残存バッチの古い取込開始日時のままだと、この実行が走っている最中に叩き直された
    // 手動実行を止められない（#489）
    const { t, deps } = await harness()
    await t.deps.dailyMailImportBatchRepository.save(leftoverImporting(0))
    let duringRun: DailyMailImportBatch | null = null

    await runDailyMailImportForUser(
      {
        ...deps,
        gmailMailFetchGateway: {
          fetchMails: async () => {
            duringRun = await t.deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)
            return { ok: true, smbcMails: [], amazonMails: [] }
          },
        },
      },
      { userId: VIEWER_ID, at: AT },
    )

    expect(duringRun).toMatchObject({ kind: 'importing', importStartedAt: AT })
  })

  it('日次の自動起動は直近に完了したバッチがあっても走る（クールダウンは手動実行だけ）', async () => {
    // 判定をワーカー側へ移すと、日次の再走査が静かに止まる
    const { deps } = await harness()
    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    const second = await runDailyMailImportForUser(deps, {
      userId: VIEWER_ID,
      at: new Date(AT.getTime() + 1_000),
    })

    expect(second.status).toBe('completed')
  })

  it('新規起動のときは再開イベントを発行しない', async () => {
    const { t, deps } = await harness()
    const resumedEvents = collect<MailImportResumed>(t, 'MailImportResumed')

    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(resumedEvents).toHaveLength(0)
  })
})

describe('日次メール取込ワーカー: 進捗の記録と引き継ぎ', () => {
  it('取込済み件数が 10 件ごとにバッチへ書き戻される（途中で落ちてもどこまで進んだか残る）', async () => {
    const mails = Array.from({ length: 11 }, (_, i) => mailBody(`gmail-${i + 1}`))
    const { t, deps } = await harness({ mails })
    const savedProgress: number[] = []
    const repository = t.deps.dailyMailImportBatchRepository
    const originalSave = repository.save.bind(repository)
    vi.spyOn(repository, 'save').mockImplementation(async batch => {
      if (batch.kind === 'importing') savedProgress.push(batch.importedCount)
      await originalSave(batch)
    })

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome).toMatchObject({ status: 'completed', importedCount: 11 })
    // 取込開始（0）と 10 件目の書き戻し。11 件目は間隔に満たないので完了記録が拾う
    expect(savedProgress).toEqual([0, 10])
  })

  it('進捗の残った取込中バッチを引き継ぐと、前回ぶんに積み増して完了する', async () => {
    const mails = Array.from({ length: 10 }, (_, i) => mailBody(`gmail-${i + 1}`))
    const { t, deps } = await harness({ mails })
    await t.deps.dailyMailImportBatchRepository.save(leftoverImporting(12))

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    // 前回 12 件 + 今回 10 件。0 から数え直すと「取込済み件数は減らせない」に触れて失敗する
    expect(outcome).toMatchObject({ status: 'completed', resumed: true, importedCount: 22 })
    const batch = await t.deps.dailyMailImportBatchRepository.findById(
      launched(outcome).importBatchId,
    )
    expect(batch).toMatchObject({ kind: 'completed', importedCount: 22 })
  })

  it('起動記録だけ残して落ちたバッチ（取込前）も引き継いで完了する', async () => {
    const { t, deps } = await harness({ mails: [mailBody('gmail-1')] })
    const resumedEvents = collect<MailImportResumed>(t, 'MailImportResumed')
    await t.deps.dailyMailImportBatchRepository.save(
      DailyMailImportBatchSchema.parse({
        kind: 'started',
        common: leftoverImporting(0).common,
      }),
    )

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome).toMatchObject({
      status: 'completed',
      resumed: true,
      importBatchId: LEFTOVER_BATCH_ID,
      importedCount: 1,
    })
    expect(resumedEvents).toHaveLength(1)
  })
})

describe('日次メール取込ワーカー: トークン失効の検知', () => {
  it('取得で失効を検知したらトークンを失効検知済みにし、失効検知イベントを発行する', async () => {
    const t = createTestApp()
    await authorize(t, VIEWER_ID)
    const detected = collect<GmailOauthRevocationDetected>(t, 'GmailOauthRevocationDetected')

    await runDailyMailImportForUser(
      {
        ...t.deps,
        gmailMailFetchGateway: fetchGatewayFailing({
          ok: false,
          failure: {
            kind: 'oauth_revocation_detected',
            detail: 'refresh token が失効している（invalid_grant）',
            detectedAt: AT,
          },
        }),
        parseSmbcNotificationMail: cardUsageParser(),
      },
      { userId: VIEWER_ID, at: AT },
    )

    const token = await t.deps.gmailOAuthTokenRepository.findByUserId(VIEWER_ID)
    expect(token).toMatchObject({
      kind: 'revocation_detected',
      revocationReason: 'api_call_failure',
    })
    expect(detected).toHaveLength(1)
    expect(detected[0]?.userId).toBe(VIEWER_ID)
  })

  it('その他の取得失敗ではトークンを失効扱いにしない（通信断で再認可を求めない）', async () => {
    const t = createTestApp()
    await authorize(t, VIEWER_ID)
    const detected = collect<GmailOauthRevocationDetected>(t, 'GmailOauthRevocationDetected')

    await runDailyMailImportForUser(
      {
        ...t.deps,
        gmailMailFetchGateway: fetchGatewayFailing({
          ok: false,
          failure: {
            kind: 'other_fetch_failure',
            detail: 'Gmail API がタイムアウトした（list）',
            detectedAt: AT,
            retryable: true,
          },
        }),
        parseSmbcNotificationMail: cardUsageParser(),
      },
      { userId: VIEWER_ID, at: AT },
    )

    expect(await t.deps.gmailOAuthTokenRepository.findByUserId(VIEWER_ID)).toMatchObject({
      kind: 'valid',
    })
    expect(detected).toHaveLength(0)
  })
})

describe('日次メール取込ワーカー: 持ち主の取り違え防止', () => {
  it('パース結果が別人のものなら取引候補を作らず失敗として閉じる', async () => {
    const t = createTestApp()
    await authorize(t, VIEWER_ID)
    const spouseParser: SmbcNotificationMailParser = ({ mail }) =>
      SmbcMailParseResultSchema.parse({
        kind: 'card_usage',
        gmailMessageId: mail.gmailMessageId,
        // メール本文（外部入力）由来で持ち主がすり替わった状況を作る
        userId: SPOUSE_ID,
        merchantName: 'スーパーA',
        amount: money(1200),
        occurredAt: OCCURRED_AT,
        cardKind: 'mitsui_sumitomo',
      })

    const outcome = await runDailyMailImportForUser(
      {
        ...t.deps,
        gmailMailFetchGateway: fetchGatewayReturning([mailBody('gmail-1')]),
        parseSmbcNotificationMail: spouseParser,
      },
      { userId: VIEWER_ID, at: AT },
    )

    expect(outcome).toMatchObject({
      status: 'failed',
      failureKind: 'unexpected_error',
      // 実装の誤りなのでやり直しても直らない
      retryable: false,
    })
    expect(await savedCandidates(t, ['gmail-1'])).toHaveLength(0)
  })
})

describe('日次メール取込ワーカー: 世帯一括', () => {
  it('夫婦それぞれの受信箱を取り込む', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    await t.deps.appUserRepository.save(registerAppUser(SPOUSE_ID, 'darling', undefined, AT))
    await authorize(t, VIEWER_ID)
    await authorize(t, SPOUSE_ID)
    const gateway = fetchGatewayReturning([mailBody('gmail-1')])

    const outcome = await runDailyMailImportForHousehold(
      { ...t.deps, gmailMailFetchGateway: gateway, parseSmbcNotificationMail: cardUsageParser() },
      { at: AT },
    )

    expect(outcome.results.map(r => r.status)).toEqual(['imported', 'imported'])
    expect(gateway.requests.map(r => r.userId).sort()).toEqual([SPOUSE_ID, VIEWER_ID].sort())
  })

  it('片方が未登録でも、もう片方の取込は実行される', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    await authorize(t, VIEWER_ID)
    const gateway = fetchGatewayReturning([mailBody('gmail-1')])

    const outcome = await runDailyMailImportForHousehold(
      { ...t.deps, gmailMailFetchGateway: gateway, parseSmbcNotificationMail: cardUsageParser() },
      { at: AT },
    )

    expect(outcome.results.find(r => r.role === 'honey')?.status).toBe('imported')
    expect(outcome.results.find(r => r.role === 'darling')?.status).toBe('not_registered')
    expect(gateway.requests).toHaveLength(1)
  })

  it('片方が Gmail 未連携なら「対象外」として結果に残り、もう片方の取込は実行される', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    await t.deps.appUserRepository.save(registerAppUser(SPOUSE_ID, 'darling', undefined, AT))
    await authorize(t, VIEWER_ID)
    const gateway = fetchGatewayReturning([mailBody('gmail-1')])
    const save = vi.spyOn(t.deps.dailyMailImportBatchRepository, 'save')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const outcome = await runDailyMailImportForHousehold(
      { ...t.deps, gmailMailFetchGateway: gateway, parseSmbcNotificationMail: cardUsageParser() },
      { at: AT },
    )

    expect(outcome.results.find(r => r.role === 'honey')?.status).toBe('imported')
    expect(outcome.results.find(r => r.role === 'darling')).toMatchObject({
      status: 'not_launched',
      reason: 'not_linked',
    })
    expect(gateway.requests).toHaveLength(1)
    // 未連携の側は取込記録を一切残さない（残すと連携されるまで毎日 1 件ずつ積み上がる）。
    // 「失敗として数えない」だけでは、結末の型が違うことしか担保できない
    const savedUserIds = save.mock.calls.map(([batch]) => batch.common.userId)
    expect(savedUserIds).not.toContain(SPOUSE_ID)
    expect(savedUserIds).toContain(VIEWER_ID)
  })

  it('走査幅の指定が各ユーザーの取込に渡る', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    await authorize(t, VIEWER_ID)
    const gateway = fetchGatewayReturning([])

    await runDailyMailImportForHousehold(
      { ...t.deps, gmailMailFetchGateway: gateway, parseSmbcNotificationMail: cardUsageParser() },
      { at: AT, scanDays: 1 },
    )

    expect(gateway.requests[0]?.period.from).toEqual(new Date('2026-07-09T00:00:00+09:00'))
  })

  it('1 人の取込が落ちても、もう 1 人の取込は続行する', async () => {
    const t = createTestApp()
    await t.deps.appUserRepository.save(registerAppUser(VIEWER_ID, 'honey', undefined, AT))
    await t.deps.appUserRepository.save(registerAppUser(SPOUSE_ID, 'darling', undefined, AT))
    await authorize(t, VIEWER_ID)
    await authorize(t, SPOUSE_ID)
    const gateway = fetchGatewayReturning([mailBody('gmail-1')])
    const repository = t.deps.dailyMailImportBatchRepository
    vi.spyOn(repository, 'findInProgressByUser').mockImplementation(async (userId: UserId) => {
      if (userId === VIEWER_ID) throw new Error('database unavailable')
      return null
    })

    const outcome = await runDailyMailImportForHousehold(
      { ...t.deps, gmailMailFetchGateway: gateway, parseSmbcNotificationMail: cardUsageParser() },
      { at: AT },
    )

    expect(outcome.results.find(r => r.role === 'honey')?.status).toBe('failed')
    expect(outcome.results.find(r => r.role === 'darling')?.status).toBe('imported')
  })
})
