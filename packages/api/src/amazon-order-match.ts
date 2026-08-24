/**
 * Amazon 注文突合（08a §2「Amazon注文確認メール本文をパースする」/「Amazon注文とSMBCカード利用通知を突合する」）
 *
 * カードで Amazon の買い物をすると、カード利用通知には「AMAZON CO JP・2,420 円」としか書かれて
 * おらず、何を買ったのかは分からない。同じ金額の注文確認メールと結び付けて、取引候補に商品名を
 * 付けるのが本モジュールの責務で、日次メール取込ワーカーの一部として毎回の取込の最後に走る。
 *
 * 進め方（判定規則そのものはドメインの純粋関数が持つ。ここは順番と保存・記録だけを持つ）:
 *
 *  1. 取得した注文確認メールをパースする（読めなかったものは件数に出す。取込は止めない）
 *  2. 突合の相手になりうる「メール由来・未突合」の取引候補を、注文日の前後 3 日ぶん引く
 *  3. `matchAmazonOrders` で一意に決まる組み合わせだけを突合し、候補に商品名を付けて保存する
 *  4. 突合できなかった注文のうち、受信から 3 日を過ぎたものは破棄する（Amazon 先着タイムアウト。
 *     配送キャンセルの可能性があるため取引候補にしない）
 *  5. カード利用通知が先に届いたまま 3 日が過ぎた候補を「Amazon 注文不明」で未分類確定にする
 *     （SMBC 先着タイムアウト。V-2）
 *
 * **突合の状態は永続化しない。** 日次取込は毎回「過去 `scanDays` 日（既定 5 日）」を再走査する
 * （OQ-31）ため、タイムアウト期限の 3 日ぶんの注文確認メールは毎回もう一度取得できる。保留を
 * テーブルに持つと、メール側と保留側のどちらが正かを保つ手当てが要るうえ、取りこぼしの回収が
 * 再走査と保留テーブルの 2 経路になる。期限の判定は受信日時と現在時刻だけで決まるので、毎回
 * 計算し直すほうが状態のずれが起きない。
 *
 * この作りは `scanDays` がタイムアウト日数（3 日）以上であることに依存する。短く設定すると
 * 期限内の注文確認メールを取り直せず、突合できるはずの組み合わせを取りこぼすため、下回る設定
 * では警告を出す。
 *
 * 突合の成否にかかわらず、取引候補の金額は変わらない（変わるのは商品名が付くかどうかだけ）。
 * 一意に決められないときに突合しないのはこのためで、誤った商品名が家計簿に残るより、未分類の
 * まま後から手で分類できるほうが害が小さい。
 */
import {
  AMAZON_MATCH_TIMEOUT_DAYS,
  AmazonOrderSmbcMatchedSchema,
  AmazonProductInfoExtractedSchema,
  InvariantViolationError,
  MailParseFailedSchema,
  confirmMatchTimeout,
  emailGmailMessageIdOf,
  isAmazonMerchantName,
  judgeAmazonMatchTimeout,
  judgeCardUsageMatchTimeout,
  matchAmazonOrder,
  matchAmazonOrders,
} from '@warimaru/domain'
import type {
  AmazonOrderConfirmationMailBody,
  AmazonOrderConfirmationMailParser,
  AmazonOrderInfo,
  EventBus,
  ImportTargetPeriod,
  NormalTransactionCandidate,
  TransactionCandidateRepository,
  UserId,
} from '@warimaru/domain'
import { domainEventBase } from './event-handlers/index.js'

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000
const TIMEOUT_MILLIS = AMAZON_MATCH_TIMEOUT_DAYS * MILLIS_PER_DAY

export interface AmazonOrderMatchDeps {
  transactionCandidateRepository: TransactionCandidateRepository
  /** Amazon 注文確認メール本文のパース（実装はドメインの `parseAmazonOrderConfirmationMail`） */
  parseAmazonOrderConfirmationMail: AmazonOrderConfirmationMailParser
  eventBus: EventBus
}

export interface AmazonOrderMatchParams {
  userId: UserId
  /** この実行で取得した注文確認メール（過去 `scanDays` 日ぶんの再走査を含む） */
  amazonMails: readonly AmazonOrderConfirmationMailBody[]
  /** この実行がメールを取り直した期間。タイムアウト期限を覆えているかの確認に使う */
  targetPeriod: ImportTargetPeriod
  at: Date
}

/**
 * 突合の結末。取込結果に載せて、突合が動いているか・何件が宙に浮いているかを、
 * バッチ記録を引かずに追えるようにする。
 */
export interface AmazonOrderMatchSummary {
  /** 読み取れた注文確認メールの件数 */
  parsedCount: number
  /** 読み取れなかった件数（本文構造が変わると増える） */
  parseFailedCount: number
  /** カード利用通知と結び付いて商品名が付いた件数 */
  matchedCount: number
  /** まだ結び付けられず、期限内で待っている件数 */
  pendingCount: number
  /** 受信から 3 日を過ぎ、結び付かないまま破棄した注文の件数 */
  expiredCount: number
  /** Amazon 注文が届かないまま 3 日が過ぎ、「Amazon 注文不明」で未分類確定にした候補の件数 */
  cardUsageTimedOutCount: number
}

/** 突合の相手を探す範囲。注文の前後 3 日を全注文ぶん包む */
function matchWindow(orders: readonly AmazonOrderInfo[]): { from: Date; to: Date } | null {
  const times = orders.map(o => o.orderedAt.getTime())
  if (times.length === 0) return null
  return {
    from: new Date(Math.min(...times) - TIMEOUT_MILLIS),
    to: new Date(Math.max(...times) + TIMEOUT_MILLIS),
  }
}

/**
 * 取得済みの注文確認メールを突合まで進める。
 *
 * 呼出し元（日次メール取込ワーカー）は SMBC 通知の取込を終えたあとにこれを呼ぶ。順番が逆だと、
 * 同じ実行で取り込んだカード利用通知が突合の相手に入らず、突合が 1 日ぶん遅れる。
 */
export async function runAmazonOrderMatching(
  deps: AmazonOrderMatchDeps,
  params: AmazonOrderMatchParams,
): Promise<AmazonOrderMatchSummary> {
  const { userId, amazonMails, at } = params
  warnIfPeriodTooShort(params.targetPeriod)

  const orders: AmazonOrderInfo[] = []
  let parseFailedCount = 0
  for (const mail of amazonMails) {
    const parsed = deps.parseAmazonOrderConfirmationMail({ mail, userId, at })
    if (parsed.kind === 'parse_failure') {
      parseFailedCount++
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
    if (parsed.order.userId !== userId) {
      // 持ち主は取込を起動したバッチが決める。パース結果はメール本文（外部入力）から作られる
      // ため、そこに現れたユーザーを信じると相手の買い物が本人の候補に紐づきうる
      throw new InvariantViolationError('パース結果の持ち主が取込対象のユーザーと一致しない')
    }
    orders.push(parsed.order)
  }

  const window = matchWindow(orders)
  const cardUsageCandidates =
    window === null
      ? []
      : await deps.transactionCandidateRepository.findEmailSourcedNormalCandidates(userId, {
          occurredFrom: window.from,
          occurredTo: window.to,
        })

  const outcomes = matchAmazonOrders({ orders, cardUsageCandidates })
  const matchedCandidateIds = new Set<string>()
  let matchedCount = 0
  let pendingCount = 0
  let expiredCount = 0

  for (const outcome of outcomes) {
    if (outcome.kind === 'matched') {
      const smbcGmailMessageId = emailGmailMessageIdOf(outcome.candidate)
      const matched = matchAmazonOrder(outcome.candidate, outcome.order, at)
      await deps.transactionCandidateRepository.save(matched)
      matchedCandidateIds.add(matched.common.transactionCandidateId)
      matchedCount++
      await deps.eventBus.publish(
        AmazonOrderSmbcMatchedSchema.parse({
          ...domainEventBase(at),
          type: 'AmazonOrderSmbcMatched',
          amazonOrderId: outcome.order.amazonOrderId,
          smbcGmailMessageId,
        }),
      )
      // 商品情報が取引候補に載った時点で 1 度だけ出す。パースできた時点で出すと、同じメールを
      // 再走査で取り直すたびに同じ内容のイベントが出てしまう（突合済みの候補は次の実行の
      // 相手にならないため、突合の時点なら 1 回に収まる）
      await deps.eventBus.publish(
        AmazonProductInfoExtractedSchema.parse({
          ...domainEventBase(at),
          type: 'AmazonProductInfoExtracted',
          amazonOrderId: outcome.order.amazonOrderId,
          userId,
          productNames: outcome.order.products.map(p => p.productName),
        }),
      )
      continue
    }
    if (judgeAmazonMatchTimeout(outcome.pending, at) === 'timeout_confirmed') expiredCount++
    else pendingCount++
  }

  const cardUsageTimedOutCount = await confirmCardUsageTimeouts(
    deps,
    userId,
    at,
    matchedCandidateIds,
  )

  const summary: AmazonOrderMatchSummary = {
    parsedCount: orders.length,
    parseFailedCount,
    matchedCount,
    pendingCount,
    expiredCount,
    cardUsageTimedOutCount,
  }
  reportSummary(summary)
  return summary
}

/**
 * カード利用通知が先に届いたまま Amazon の注文確認メールが 3 日届かなかった候補を、
 * 「Amazon 注文不明」の未分類確定へ遷移させる（SMBC 先着タイムアウト。V-2）。
 *
 * 期限より前の候補には触れない（まだ注文確認メールが届く見込みがある）。この実行で突合した
 * 候補も対象外にする（保存済みの kind は変わっているが、引き当てはこの実行の前に行うため）。
 *
 * 引く範囲に下限を置かないのは、取込が数日止まっていた場合に期限を過ぎた候補を取りこぼさない
 * ため。Amazon 以外のメール由来の候補も返るが、対象は世帯 2 人ぶんのカード利用通知だけで、
 * 索引（user_id, kind, occurred_on）も効くため、この規模では読み切りで足りる。
 */
async function confirmCardUsageTimeouts(
  deps: AmazonOrderMatchDeps,
  userId: UserId,
  at: Date,
  matchedCandidateIds: ReadonlySet<string>,
): Promise<number> {
  const expired = await deps.transactionCandidateRepository.findEmailSourcedNormalCandidates(
    userId,
    { occurredTo: new Date(at.getTime() - TIMEOUT_MILLIS) },
  )
  const targets = expired.filter(
    (candidate: NormalTransactionCandidate) =>
      isAmazonMerchantName(candidate.common.merchantName) &&
      !matchedCandidateIds.has(candidate.common.transactionCandidateId) &&
      judgeCardUsageMatchTimeout(candidate, at) === 'timeout_confirmed',
  )
  for (const candidate of targets) {
    await deps.transactionCandidateRepository.save(
      confirmMatchTimeout(candidate, 'smbc_first_awaiting_amazon', at),
    )
  }
  return targets.length
}

/**
 * 突合の結果を記録に残す。読めなかったメールと、宙に浮いたまま期限切れになったものは、
 * バッチ記録を引かなくても気づけるよう警告として出す（黙って捨てない）。
 *
 * メール本文・商品名・金額は出さない（買ったものは PII に当たる）。件数だけを載せる。
 */
function reportSummary(summary: AmazonOrderMatchSummary): void {
  const counts =
    `読み取り=${summary.parsedCount}, 突合=${summary.matchedCount}, ` +
    `保留=${summary.pendingCount}, 期限切れ破棄=${summary.expiredCount}, ` +
    `注文不明で未分類確定=${summary.cardUsageTimedOutCount}`
  if (summary.parseFailedCount > 0 || summary.expiredCount > 0) {
    console.warn(
      `[transaction-import] Amazon 注文の突合に取りこぼしがある（` +
        `パース失敗=${summary.parseFailedCount}, ${counts}）`,
    )
    return
  }
  if (summary.parsedCount > 0 || summary.cardUsageTimedOutCount > 0) {
    console.info(`[transaction-import] Amazon 注文を突合した（${counts}）`)
  }
}

/**
 * 取り直した期間がタイムアウト期限を覆えているかの確認。短いと、期限内の注文確認メールを
 * 取り直せず、突合できるはずの組み合わせを取りこぼす（本モジュールが状態を持たない前提）。
 *
 * 日次の既定（過去 5 日）では起きない。期間を明示する手動実行で短く指定したときに出る。
 */
function warnIfPeriodTooShort(period: ImportTargetPeriod): void {
  const days = (period.to.getTime() - period.from.getTime()) / MILLIS_PER_DAY
  if (days >= AMAZON_MATCH_TIMEOUT_DAYS) return
  console.warn(
    `[transaction-import] メールを取り直した期間（${days.toFixed(1)} 日）が Amazon 突合の` +
      `タイムアウト（${AMAZON_MATCH_TIMEOUT_DAYS} 日）より短い — 期限内の注文確認メールを` +
      '取り直せず、突合できる組み合わせを取りこぼす',
  )
}
