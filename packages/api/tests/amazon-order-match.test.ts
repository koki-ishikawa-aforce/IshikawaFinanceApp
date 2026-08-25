/**
 * Amazon 注文突合（#391。08a §2 のパース → 突合 → 双方向 3 日タイムアウト）のテスト。
 *
 * 日次メール取込ワーカー越しに動かす。突合はワーカーの一部として毎回の取込の最後に走るため、
 * 「この実行で取り込んだカード利用通知が突合の相手に入る」という順序も含めてここで固定する。
 *
 * 突合は誤って結び付けないことが要点なので、金額違い・期限外・一意に決まらない組み合わせで
 * 商品名が付かないことを否定形で押さえる。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  AmazonMailParseResultSchema,
  GmailMessageIdSchema,
  GmailOAuthTokenSchema,
  ParameterStorePathSchema,
  SmbcMailParseResultSchema,
  TransactionCandidateSchema,
  money,
  parseAmazonOrderConfirmationMail,
} from '@warimaru/domain'
import type {
  AmazonOrderConfirmationMailBody,
  AmazonOrderConfirmationMailParser,
  AmazonOrderSmbcMatched,
  AmazonProductInfoExtracted,
  DomainEvent,
  GmailMailFetchGateway,
  MailFetchRequest,
  MailFetchResult,
  MailParseFailed,
  SmbcNotificationMailBody,
  SmbcNotificationMailParser,
  TransactionCandidate,
  UserId,
} from '@warimaru/domain'
import { runDailyMailImportForUser, type DailyMailImportDeps } from '../src/daily-mail-import.js'
import { createTestApp, SPOUSE_ID, VIEWER_ID, type TestApp } from './helpers/test-app.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const AT = new Date('2026-07-16T00:00:00+09:00')
const ORDER_RECEIVED_AT = new Date('2026-07-15T09:53:00+09:00')
const CARD_USED_AT = new Date('2026-07-15T14:37:00+09:00')
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

const AMAZON_MERCHANT = 'AMAZON CO JP'

function amazonBody(orderId: string, total: number, productName = 'マスタリングTCP/IP'): string {
  return [
    'Amazon.co.jp でのご注文ありがとうございます。',
    '',
    `注文番号: ${orderId}`,
    '',
    `* ${productName}`,
    '  数量: 1',
    `  ${total} JPY`,
    '',
    `合計 ${total} JPY`,
  ].join('\n')
}

function amazonMail(
  gmailMessageId: string,
  orderId: string,
  total: number,
  overrides: Partial<AmazonOrderConfirmationMailBody> = {},
): AmazonOrderConfirmationMailBody {
  return {
    gmailMessageId: GmailMessageIdSchema.parse(gmailMessageId),
    receivedAt: ORDER_RECEIVED_AT,
    subject: '注文済み',
    body: amazonBody(orderId, total),
    ...overrides,
  }
}

function smbcMail(gmailMessageId: string): SmbcNotificationMailBody {
  return {
    gmailMessageId: GmailMessageIdSchema.parse(gmailMessageId),
    receivedAt: CARD_USED_AT,
    subject: 'ご利用のお知らせ【三井住友カード】',
    body: '本文',
    kindHint: 'card_usage',
  }
}

/** カード利用としてパースするスタブ（本文の読み方そのものは domain 側で固定済み） */
function cardUsageParser(
  amount: number,
  occurredAt: Date = CARD_USED_AT,
  merchantName: string = AMAZON_MERCHANT,
): SmbcNotificationMailParser {
  return ({ mail, userId }) =>
    SmbcMailParseResultSchema.parse({
      kind: 'card_usage',
      gmailMessageId: mail.gmailMessageId,
      userId,
      merchantName,
      amount: money(amount),
      occurredAt,
      cardKind: 'mitsui_sumitomo',
    })
}

function gateway(
  smbcMails: SmbcNotificationMailBody[],
  amazonMails: AmazonOrderConfirmationMailBody[],
): GmailMailFetchGateway {
  return {
    fetchMails: (_request: MailFetchRequest): Promise<MailFetchResult> =>
      Promise.resolve({ ok: true, smbcMails, amazonMails }),
  }
}

async function authorize(t: TestApp, userId: UserId = VIEWER_ID): Promise<void> {
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

async function harness(options: {
  smbcMails?: SmbcNotificationMailBody[]
  amazonMails?: AmazonOrderConfirmationMailBody[]
  parser?: SmbcNotificationMailParser
}): Promise<{ t: TestApp; deps: DailyMailImportDeps }> {
  const t = createTestApp()
  await authorize(t)
  return {
    t,
    deps: {
      ...t.deps,
      gmailMailFetchGateway: gateway(options.smbcMails ?? [], options.amazonMails ?? []),
      parseSmbcNotificationMail: options.parser ?? cardUsageParser(2420),
      parseAmazonOrderConfirmationMail,
    },
  }
}

/** 既に取り込み済みのカード利用通知由来の候補（前の実行が作ったもの）を置く */
async function seedCardUsageCandidate(
  t: TestApp,
  options: {
    id: string
    gmailMessageId: string
    amount: number
    occurredAt: Date
    merchantName?: string
  },
): Promise<void> {
  await t.deps.transactionCandidateRepository.save(
    TransactionCandidateSchema.parse({
      kind: 'normal',
      common: {
        transactionCandidateId: options.id,
        userId: VIEWER_ID,
        importSource: { kind: 'email', gmailMessageId: options.gmailMessageId },
        merchantName: options.merchantName ?? AMAZON_MERCHANT,
        amount: money(options.amount),
        occurredAt: options.occurredAt,
      },
    }),
  )
}

async function candidateOf(t: TestApp, gmailMessageId: string): Promise<TransactionCandidate> {
  const found = await t.deps.transactionCandidateRepository.findByGmailMessageId(
    VIEWER_ID,
    GmailMessageIdSchema.parse(gmailMessageId),
  )
  if (found === null) throw new Error(`取引候補が見つからない（${gmailMessageId}）`)
  return found
}

function collect<E extends DomainEvent>(t: TestApp, type: E['type']): E[] {
  const log: E[] = []
  t.deps.eventBus.subscribe<E>(type, e => {
    log.push(e)
  })
  return log
}

function completed(outcome: Awaited<ReturnType<typeof runDailyMailImportForUser>>) {
  if (outcome.status !== 'completed') {
    throw new Error(`取込が完了しなかった（status=${outcome.status}）`)
  }
  return outcome
}

describe('Amazon 注文突合: カード利用通知に商品名を紐付ける', () => {
  it('同じ実行で届いた注文確認メールとカード利用通知が突合され、候補に商品名が付く', async () => {
    const { t, deps } = await harness({
      smbcMails: [smbcMail('gm_smbc_1')],
      amazonMails: [amazonMail('gm_amz_1', '250-1234567-1234567', 2420)],
    })
    const matchedEvents = collect<AmazonOrderSmbcMatched>(t, 'AmazonOrderSmbcMatched')
    const extractedEvents = collect<AmazonProductInfoExtracted>(t, 'AmazonProductInfoExtracted')

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch).toMatchObject({ parsedCount: 1, matchedCount: 1, pendingCount: 0 })
    const candidate = await candidateOf(t, 'gm_smbc_1')
    expect(candidate.kind).toBe('amazon_matched')
    if (candidate.kind !== 'amazon_matched') return
    expect(candidate.products).toEqual([{ productName: 'マスタリングTCP/IP', productAmount: 2420 }])
    expect(candidate.common.importSource).toEqual({
      kind: 'amazon_match',
      smbcGmailMessageId: 'gm_smbc_1',
      amazonOrderId: '250-1234567-1234567',
    })
    expect(matchedEvents).toHaveLength(1)
    expect(matchedEvents[0]).toMatchObject({
      amazonOrderId: '250-1234567-1234567',
      smbcGmailMessageId: 'gm_smbc_1',
    })
    expect(extractedEvents[0]).toMatchObject({ productNames: ['マスタリングTCP/IP'] })
  })

  it('前の実行で取り込んだ候補にも、あとから届いた注文確認メールが突合される', async () => {
    const { t, deps } = await harness({
      amazonMails: [amazonMail('gm_amz_2', '250-2222222-2222222', 3500)],
    })
    await seedCardUsageCandidate(t, {
      id: '01CND000000000000000000001',
      gmailMessageId: 'gm_smbc_seed',
      amount: 3500,
      occurredAt: CARD_USED_AT,
    })

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch.matchedCount).toBe(1)
    expect((await candidateOf(t, 'gm_smbc_seed')).kind).toBe('amazon_matched')
  })

  it('金額が一致しない注文は突合されず、候補は通常のまま残る', async () => {
    const { t, deps } = await harness({
      smbcMails: [smbcMail('gm_smbc_3')],
      amazonMails: [amazonMail('gm_amz_3', '250-3333333-3333333', 9999)],
      parser: cardUsageParser(2420),
    })

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch).toMatchObject({ matchedCount: 0, pendingCount: 1 })
    expect((await candidateOf(t, 'gm_smbc_3')).kind).toBe('normal')
  })

  it('Amazon 以外の加盟店の候補は、金額が一致しても突合されない', async () => {
    const { t, deps } = await harness({
      smbcMails: [smbcMail('gm_smbc_4')],
      amazonMails: [amazonMail('gm_amz_4', '250-4444444-4444444', 2420)],
      parser: cardUsageParser(2420, CARD_USED_AT, 'スーパーA'),
    })

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch.matchedCount).toBe(0)
    expect((await candidateOf(t, 'gm_smbc_4')).kind).toBe('normal')
  })

  it('同額の注文が 2 つ同じ日に届いた場合、どちらも突合されない（誤った紐付けを作らない）', async () => {
    const { t, deps } = await harness({
      smbcMails: [smbcMail('gm_smbc_5')],
      amazonMails: [
        amazonMail('gm_amz_5a', '250-5555555-5555551', 2420),
        amazonMail('gm_amz_5b', '250-5555555-5555552', 2420),
      ],
    })

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch).toMatchObject({ parsedCount: 2, matchedCount: 0, pendingCount: 2 })
    expect((await candidateOf(t, 'gm_smbc_5')).kind).toBe('normal')
  })

  it('注文確認メールが読めなくても取込は完了し、パース失敗として記録される', async () => {
    const { t, deps } = await harness({
      smbcMails: [smbcMail('gm_smbc_6')],
      amazonMails: [
        amazonMail('gm_amz_6', '250-6666666-6666666', 2420, {
          // 注文確認メールの目印(挨拶文)はあるが注文番号が読めない本文
          body: 'Amazon.co.jp でのご注文ありがとうございます。\n注文番号が無い本文',
        }),
      ],
    })
    const parseFailures = collect<MailParseFailed>(t, 'MailParseFailed')

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch).toMatchObject({ parsedCount: 0, parseFailedCount: 1 })
    expect(parseFailures.map(e => e.gmailMessageId)).toEqual(['gm_amz_6'])
    // カード利用通知の取込は巻き添えにならない
    expect(outcome.importedCount).toBe(1)
  })

  it('注文確認以外の Amazon メール(発送のお知らせ等)は、パース失敗として数えずイベントも出さない（#624）', async () => {
    const { t, deps } = await harness({
      smbcMails: [smbcMail('gm_smbc_shipping')],
      amazonMails: [
        amazonMail('gm_amz_shipping', '250-9090909-9090909', 2420, {
          // 注文確認メールの目印(挨拶文)を持たない、発送のお知らせを模した本文
          body: ['ご注文の商品を発送いたしました。', '', '注文番号: 250-9090909-9090909'].join(
            '\n',
          ),
        }),
      ],
    })
    const parseFailures = collect<MailParseFailed>(t, 'MailParseFailed')

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch).toMatchObject({
      parsedCount: 0,
      parseFailedCount: 0,
      matchedCount: 0,
    })
    expect(parseFailures).toHaveLength(0)
    // 突合の相手にならず、SMBC 側の候補は通常のまま残る（誤って商品名が付かない）
    expect((await candidateOf(t, 'gm_smbc_shipping')).kind).toBe('normal')
    // カード利用通知の取込は巻き添えにならない
    expect(outcome.importedCount).toBe(1)
  })

  it('注文確認・注文確認以外・パース失敗が同じ実行に混在しても、それぞれ正しく数えられる', async () => {
    const { t, deps } = await harness({
      smbcMails: [smbcMail('gm_smbc_mixed')],
      amazonMails: [
        amazonMail('gm_amz_mixed_ok', '250-1111100-1111100', 2420),
        amazonMail('gm_amz_mixed_shipping', '250-2222200-2222200', 3000, {
          body: ['ご注文の商品を発送いたしました。', '', '注文番号: 250-2222200-2222200'].join(
            '\n',
          ),
        }),
        amazonMail('gm_amz_mixed_broken', '250-3333300-3333300', 4000, {
          body: 'Amazon.co.jp でのご注文ありがとうございます。\n注文番号が無い本文',
        }),
      ],
    })
    const parseFailures = collect<MailParseFailed>(t, 'MailParseFailed')

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    // 読み取れた(=注文確認だった)のは 1 件、パース失敗も 1 件(注文確認以外は数に入らない)
    expect(outcome.amazonMatch).toMatchObject({
      parsedCount: 1,
      parseFailedCount: 1,
      matchedCount: 1,
    })
    expect(parseFailures.map(e => e.gmailMessageId)).toEqual(['gm_amz_mixed_broken'])
    expect((await candidateOf(t, 'gm_smbc_mixed')).kind).toBe('amazon_matched')
  })
})

describe('Amazon 注文突合: 再走査（同じメールをもう一度取り直したとき）', () => {
  it('翌日の再走査で同じ注文確認メールを読み直しても、突合は増えずイベントも二度出ない', async () => {
    const { t, deps } = await harness({
      smbcMails: [smbcMail('gm_smbc_rescan')],
      amazonMails: [amazonMail('gm_amz_rescan', '250-1010101-1010101', 2420)],
    })
    const matchedEvents = collect<AmazonOrderSmbcMatched>(t, 'AmazonOrderSmbcMatched')
    const extractedEvents = collect<AmazonProductInfoExtracted>(t, 'AmazonProductInfoExtracted')

    const first = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))
    const second = completed(
      await runDailyMailImportForUser(deps, {
        userId: VIEWER_ID,
        at: new Date(AT.getTime() + MILLIS_PER_DAY),
      }),
    )

    expect(first.amazonMatch.matchedCount).toBe(1)
    // 2 回目は突合済みとして読み飛ばす（期限切れ破棄にも保留にも数えない）
    expect(second.amazonMatch).toMatchObject({
      matchedCount: 0,
      alreadyMatchedCount: 1,
      pendingCount: 0,
      expiredCount: 0,
    })
    // 同じカード利用通知から 2 件目の候補が作られない（同じ支払いの二重計上）
    expect(second.importedCount).toBe(0)
    expect(matchedEvents).toHaveLength(1)
    expect(extractedEvents).toHaveLength(1)
    const candidate = await candidateOf(t, 'gm_smbc_rescan')
    expect(candidate.kind).toBe('amazon_matched')
    if (candidate.kind !== 'amazon_matched') return
    expect(candidate.products).toEqual([{ productName: 'マスタリングTCP/IP', productAmount: 2420 }])
  })

  it('突合済みの注文は、翌日に届いた同額の買い物の突合を邪魔しない', async () => {
    const { t, deps } = await harness({
      smbcMails: [smbcMail('gm_smbc_day1')],
      amazonMails: [amazonMail('gm_amz_day1', '250-1212121-1212121', 2420)],
    })
    completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    // 翌日、同じ金額の買い物がもう 1 件。1 日目の注文確認メールも再走査で戻ってくる
    const nextDay = new Date(AT.getTime() + MILLIS_PER_DAY)
    const secondDayDeps = {
      ...deps,
      gmailMailFetchGateway: gateway(
        [{ ...smbcMail('gm_smbc_day2'), receivedAt: nextDay }],
        [
          amazonMail('gm_amz_day1', '250-1212121-1212121', 2420),
          amazonMail('gm_amz_day2', '250-1313131-1313131', 2420, { receivedAt: nextDay }),
        ],
      ),
      parseSmbcNotificationMail: cardUsageParser(2420, nextDay),
    }

    const outcome = completed(
      await runDailyMailImportForUser(secondDayDeps, { userId: VIEWER_ID, at: nextDay }),
    )

    expect(outcome.amazonMatch).toMatchObject({ matchedCount: 1, alreadyMatchedCount: 1 })
    expect((await candidateOf(t, 'gm_smbc_day2')).kind).toBe('amazon_matched')
  })
})

describe('Amazon 注文突合: 持ち主の取り違え防止と失敗時のバッチの閉じ方', () => {
  it('パース結果が別人のものなら突合せず、バッチを失敗として閉じる', async () => {
    const { t, deps } = await harness({
      amazonMails: [amazonMail('gm_amz_spouse', '250-2020202-2020202', 2420)],
    })
    const spouseParser: AmazonOrderConfirmationMailParser = ({ mail }) =>
      AmazonMailParseResultSchema.parse({
        kind: 'order_confirmation',
        order: {
          amazonOrderId: '250-2020202-2020202',
          // メール本文（外部入力）由来で持ち主がすり替わった状況を作る
          userId: SPOUSE_ID,
          gmailMessageId: mail.gmailMessageId,
          orderedAt: ORDER_RECEIVED_AT,
          orderTotal: money(2420),
          products: [{ productName: '本', productAmount: money(2420) }],
        },
      })

    const outcome = await runDailyMailImportForUser(
      { ...deps, parseAmazonOrderConfirmationMail: spouseParser },
      { userId: VIEWER_ID, at: AT },
    )

    expect(outcome).toMatchObject({
      status: 'failed',
      failureKind: 'unexpected_error',
      // 実装の誤りなのでやり直しても直らない
      retryable: false,
    })
    // 二重起動防止のロックが残らない
    expect(await t.deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)).toBeNull()
  })

  it('突合の途中で落ちても、バッチは取込中のまま残らない（翌日の取込が起動できる）', async () => {
    const { t, deps } = await harness({ smbcMails: [smbcMail('gm_smbc_boom')] })
    const failing = {
      ...t.deps.transactionCandidateRepository,
      findEmailSourcedNormalCandidates: () => Promise.reject(new Error('injected read failure')),
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const outcome = await runDailyMailImportForUser(
      { ...deps, transactionCandidateRepository: failing },
      { userId: VIEWER_ID, at: AT },
    )

    expect(outcome).toMatchObject({
      status: 'failed',
      failureKind: 'unexpected_error',
      // 一時的な失敗なので翌日の再走査でやり直せる
      retryable: true,
    })
    expect(await t.deps.dailyMailImportBatchRepository.findInProgressByUser(VIEWER_ID)).toBeNull()
  })
})

describe('Amazon 注文突合: 記録（取りこぼしに気づけるか）', () => {
  it('取り直した期間がタイムアウト期限より短い実行では、注文不明の確定を見送って警告を出す', async () => {
    const occurredAt = new Date(AT.getTime() - 10 * MILLIS_PER_DAY)
    const { t, deps } = await harness({})
    await seedCardUsageCandidate(t, {
      id: '01CND000000000000000000006',
      gmailMessageId: 'gm_smbc_short_period',
      amount: 2420,
      occurredAt,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const outcome = completed(
      await runDailyMailImportForUser(deps, {
        userId: VIEWER_ID,
        at: AT,
        period: { from: new Date(AT.getTime() - MILLIS_PER_DAY), to: AT },
      }),
    )

    expect(outcome.amazonMatch.cardUsageTimedOutCount).toBe(0)
    expect((await candidateOf(t, 'gm_smbc_short_period')).kind).toBe('normal')
    const message = warn.mock.calls.map(args => String(args[0])).join('\n')
    expect(message).toContain('注文不明の確定を見送った')
  })

  it('読み取れなかった注文確認メールは警告として記録され、本文・商品名は載らない', async () => {
    const { deps } = await harness({
      amazonMails: [
        amazonMail('gm_amz_warn', '250-3030303-3030303', 2420, {
          body: 'Amazon.co.jp でのご注文ありがとうございます。\n注文番号が無い本文',
        }),
      ],
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT })

    const message = warn.mock.calls.map(args => String(args[0])).join('\n')
    expect(message).toContain('パース失敗=1')
    expect(message).not.toContain('マスタリングTCP/IP')
    expect(message).not.toContain('注文番号が無い本文')
  })
})

describe('Amazon 注文突合: 双方向 3 日のタイムアウト', () => {
  it('注文確認メールが 3 日届かなかったカード利用通知は「Amazon 注文不明」で未分類確定になる', async () => {
    const occurredAt = new Date(AT.getTime() - 4 * MILLIS_PER_DAY)
    const { t, deps } = await harness({})
    await seedCardUsageCandidate(t, {
      id: '01CND000000000000000000002',
      gmailMessageId: 'gm_smbc_old',
      amount: 2420,
      occurredAt,
    })

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch.cardUsageTimedOutCount).toBe(1)
    const candidate = await candidateOf(t, 'gm_smbc_old')
    expect(candidate.kind).toBe('match_timeout')
    if (candidate.kind !== 'match_timeout') return
    expect(candidate.timeoutDirection).toBe('smbc_first_awaiting_amazon')
    expect(candidate.timedOutAt).toEqual(AT)
  })

  it('期限内のカード利用通知は未分類確定にしない（注文確認メールが届く見込みがある）', async () => {
    const { t, deps } = await harness({})
    await seedCardUsageCandidate(t, {
      id: '01CND000000000000000000003',
      gmailMessageId: 'gm_smbc_recent',
      amount: 2420,
      occurredAt: new Date(AT.getTime() - 2 * MILLIS_PER_DAY),
    })

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch.cardUsageTimedOutCount).toBe(0)
    expect((await candidateOf(t, 'gm_smbc_recent')).kind).toBe('normal')
  })

  it('Amazon 以外の加盟店の候補は、3 日過ぎても未分類確定にしない', async () => {
    const { t, deps } = await harness({})
    await seedCardUsageCandidate(t, {
      id: '01CND000000000000000000004',
      gmailMessageId: 'gm_smbc_other',
      amount: 2420,
      occurredAt: new Date(AT.getTime() - 10 * MILLIS_PER_DAY),
      merchantName: 'スーパーA',
    })

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch.cardUsageTimedOutCount).toBe(0)
    expect((await candidateOf(t, 'gm_smbc_other')).kind).toBe('normal')
  })

  it('カード利用通知が 3 日届かなかった注文は破棄され、取引候補は作られない', async () => {
    const receivedAt = new Date(AT.getTime() - 4 * MILLIS_PER_DAY)
    const { t, deps } = await harness({
      amazonMails: [amazonMail('gm_amz_expired', '250-7777777-7777777', 2420, { receivedAt })],
    })

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch).toMatchObject({ parsedCount: 1, expiredCount: 1, pendingCount: 0 })
    expect(
      await t.deps.transactionCandidateRepository.findByGmailMessageId(
        VIEWER_ID,
        GmailMessageIdSchema.parse('gm_amz_expired'),
      ),
    ).toBeNull()
  })

  it('期限を過ぎた注文は、金額の合うカード利用通知が後から現れても突合しない', async () => {
    const receivedAt = new Date(AT.getTime() - 5 * MILLIS_PER_DAY)
    const { t, deps } = await harness({
      amazonMails: [amazonMail('gm_amz_stale', '250-8888888-8888888', 2420, { receivedAt })],
    })
    await seedCardUsageCandidate(t, {
      id: '01CND000000000000000000005',
      gmailMessageId: 'gm_smbc_late',
      amount: 2420,
      occurredAt: new Date(AT.getTime() - 1 * MILLIS_PER_DAY),
    })

    const outcome = completed(await runDailyMailImportForUser(deps, { userId: VIEWER_ID, at: AT }))

    expect(outcome.amazonMatch.matchedCount).toBe(0)
    expect((await candidateOf(t, 'gm_smbc_late')).kind).toBe('normal')
  })
})
