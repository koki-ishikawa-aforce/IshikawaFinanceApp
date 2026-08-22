/**
 * 日次メール取込ワーカー（#414。08a §2 の取得 → 重複除外 → パース → 候補生成）のテスト。
 *
 * 起動はスケジューラ（#416 の Lambda エントリポイント）と手動 API の 2 経路だが、進行そのものは
 * ワーカーが持つため、ルートを介さず直接呼んで固定する。Gmail 取得（driven port）とパース関数は
 * 注入して、取得結果・パース結果の組み合わせごとの結末を検証する。
 */
import { describe, it, expect, vi } from 'vitest'
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
  DomainEvent,
  DuplicateExcluded,
  GmailMailFetchGateway,
  GmailMessageId,
  MailFetchRequest,
  MailFetchResult,
  MailImportBatchCompleted,
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
} from '../src/daily-mail-import.js'
import { createTestApp, SPOUSE_ID, VIEWER_ID, type TestApp } from './helpers/test-app.js'

const AT = new Date('2026-07-10T00:00:00+09:00')
const OCCURRED_AT = new Date('2026-07-09T12:34:00+09:00')

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
): GmailMailFetchGateway & { requests: MailFetchRequest[] } {
  const requests: MailFetchRequest[] = []
  return {
    requests,
    fetchMails: (request: MailFetchRequest): Promise<MailFetchResult> => {
      requests.push(request)
      return Promise.resolve({ ok: true, smbcMails, amazonMails: [] })
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

async function savedCandidates(t: TestApp, ids: string[]): Promise<TransactionCandidate[]> {
  const found = await Promise.all(
    ids.map(id =>
      t.deps.transactionCandidateRepository.findByGmailMessageId(GmailMessageIdSchema.parse(id)),
    ),
  )
  return found.filter((c): c is TransactionCandidate => c !== null)
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

    const batch = await t.deps.dailyMailImportBatchRepository.findById(outcome.importBatchId)
    expect(batch?.kind).toBe('completed')
    expect(extracted).toHaveLength(1)
    expect(completedEvents[0]?.importedCount).toBe(1)
  })

  it('取込対象期間は既定で過去 5 日ぶん（OQ-31）で、scanDays で調整できる', async () => {
    const { deps, gateway } = await harness()
    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })
    const defaultPeriod = gateway.requests[0]?.period
    expect(defaultPeriod?.to).toEqual(AT)
    expect(defaultPeriod?.from).toEqual(
      new Date(AT.getTime() - DEFAULT_MAIL_SCAN_DAYS * 24 * 60 * 60 * 1000),
    )

    const later = new Date(AT.getTime() + 24 * 60 * 60 * 1000)
    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: later, scanDays: 1 })
    expect(gateway.requests[1]?.period.from).toEqual(
      new Date(later.getTime() - 24 * 60 * 60 * 1000),
    )
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
      await existing.findByGmailMessageId(GmailMessageIdSchema.parse('gmail-1')),
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
      deferredCount: 1,
    })
    expect(await savedCandidates(t, ['gmail-1'])).toHaveLength(0)
  })
})

describe('日次メール取込ワーカー: 取得できないときの結末', () => {
  it('Gmail 未連携なら取得を試みずに失敗として閉じる', async () => {
    const t = createTestApp()
    const gateway = fetchGatewayReturning([mailBody('gmail-1')])
    const deps: DailyMailImportDeps = {
      ...t.deps,
      gmailMailFetchGateway: gateway,
      parseSmbcNotificationMail: cardUsageParser(),
    }

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome).toMatchObject({
      status: 'failed',
      failureKind: 'gmail_not_authorized',
      retryable: false,
    })
    expect(gateway.requests).toHaveLength(0)
    const batch = await t.deps.dailyMailImportBatchRepository.findById(outcome.importBatchId)
    expect(batch?.kind).toBe('failed')
    // 失敗は終端なので、次の実行が新しいバッチを起動できる（ロックが残らない）
    expect(await t.deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)).toBeNull()
  })

  it('失効検知済みのトークンでは取得を試みない（再認可待ち）', async () => {
    const t = createTestApp()
    await t.deps.gmailOAuthTokenRepository.save(
      GmailOAuthTokenSchema.parse({
        kind: 'revocation_detected',
        userId: VIEWER_ID,
        tokenStoreRef: ParameterStorePathSchema.parse('/warimaru/gmail/honey'),
        authorizedAt: AT,
        revocationDetectedAt: AT,
        revocationReason: 'expired',
      }),
    )
    const gateway = fetchGatewayReturning([mailBody('gmail-1')])

    const outcome = await runDailyMailImportForUser(
      { ...t.deps, gmailMailFetchGateway: gateway, parseSmbcNotificationMail: cardUsageParser() },
      { userId: VIEWER_ID, at: AT },
    )

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'gmail_not_authorized' })
    expect(gateway.requests).toHaveLength(0)
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
  })

  it('取得後の処理で落ちてもバッチは失敗として閉じる（取込中のまま残さない）', async () => {
    const { t, deps } = await harness({ mails: [mailBody('gmail-1')] })
    vi.spyOn(t.deps.transactionCandidateRepository, 'save').mockRejectedValue(
      new Error('database unavailable'),
    )

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'unexpected_error' })
    expect(await t.deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)).toBeNull()
    vi.restoreAllMocks()
  })
})

describe('日次メール取込ワーカー: 途中で終わった取込の再開', () => {
  it('残っている取込中バッチを引き継ぎ、MailImportResumed を発行する', async () => {
    const { t, deps, gateway } = await harness({ mails: [mailBody('gmail-1')] })
    const resumedEvents = collect<MailImportResumed>(t, 'MailImportResumed')
    const leftover = DailyMailImportBatchSchema.parse({
      kind: 'importing',
      common: {
        importBatchId: '01BATCH0000000000000000000',
        userId: VIEWER_ID,
        launchedAt: new Date('2026-07-09T00:00:00+09:00'),
        targetPeriod: {
          from: new Date('2026-07-04T00:00:00+09:00'),
          to: new Date('2026-07-09T00:00:00+09:00'),
        },
      },
      importStartedAt: new Date('2026-07-09T00:00:00+09:00'),
      importedCount: 0,
    })
    await t.deps.dailyMailImportBatchRepository.save(leftover)

    const outcome = await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(outcome.resumed).toBe(true)
    expect(outcome.importBatchId).toBe('01BATCH0000000000000000000')
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

    expect(first.importBatchId).not.toBe(second.importBatchId)
    expect(second).toMatchObject({ status: 'completed', importedCount: 0, resumed: false })
    expect(await savedCandidates(t, ['gmail-1'])).toHaveLength(1)
  })

  it('新規起動のときは再開イベントを発行しない', async () => {
    const { t, deps } = await harness()
    const resumedEvents = collect<MailImportResumed>(t, 'MailImportResumed')

    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    expect(resumedEvents).toHaveLength(0)
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
    vi.restoreAllMocks()
  })
})
