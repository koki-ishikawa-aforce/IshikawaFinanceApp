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
  amazonMatchDeadlineBefore,
  amazonMatchWindowOf,
  judgeAmazonFirstTimeout,
  judgeSmbcFirstTimeout,
  matchAmazonOrder,
  matchAmazonOrders,
} from '@warimaru/domain'
import type {
  AmazonOrderConfirmationMailBody,
  AmazonOrderConfirmationMailParser,
  AmazonOrderInfo,
  EventBus,
  ImportBatchId,
  ImportTargetPeriod,
  NormalTransactionCandidate,
  TransactionCandidateRepository,
  UserId,
} from '@warimaru/domain'
import { domainEventBase } from './event-handlers/index.js'

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * SMBC 先着タイムアウトの掃き出しで、期限よりどれだけ過去まで遡って探すか。
 *
 * 毎日の取込が拾い続ける前提なので、期限（3 日）を少し過ぎた候補さえ拾えれば足りる。長めに
 * 取ってあるのは、取込が数日〜数週間止まっても再開時に取りこぼしを回収できるようにするため。
 */
const TIMEOUT_SWEEP_LOOKBACK_DAYS = 90

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
  /** この実行がメールを取り直した期間。タイムアウトを確定してよいかの判定に使う */
  targetPeriod: ImportTargetPeriod
  /** ログの識別子。世帯 2 人ぶんの実行が同じプロセスで続くため、行だけでは区別できない */
  importBatchId: ImportBatchId
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
  /** 突合済みとして読み飛ばした件数（再走査で取り直した、前の実行で済んだ注文） */
  alreadyMatchedCount: number
  /** まだ結び付けられず、期限内で待っている件数 */
  pendingCount: number
  /**
   * 待っても解消しない保留の件数（同額の組み合わせが一意に決まらない）。`pendingCount` の内数。
   * 待てば直る保留と混ぜると、規則を直す必要があるのかが記録から判断できない
   */
  ambiguousCount: number
  /** 受信から 3 日を過ぎ、結び付かないまま破棄した注文の件数 */
  expiredCount: number
  /** Amazon 注文が届かないまま 3 日が過ぎ、「Amazon 注文不明」で未分類確定にした候補の件数 */
  cardUsageTimedOutCount: number
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
  const { userId, amazonMails, at, importBatchId } = params

  const orders: AmazonOrderInfo[] = []
  let parseFailedCount = 0
  for (const mail of amazonMails) {
    const parsed = deps.parseAmazonOrderConfirmationMail({ mail, userId, at })
    // 送信元ドメインだけで絞られているため、発送のお知らせ等の注文確認以外のメールも同じ袋で
    // 届く（#624）。これらは件数にもイベントにも出さない — 出すと「読めなかった件数」が
    // 定常的にふくらみ、Amazon が本当に注文確認メールの書式を変えたときに気づけなくなる
    if (parsed.kind === 'not_order_confirmation') continue
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

  // 前の実行で突合が済んだ注文を落とす。再走査で同じ注文確認メールが毎回戻ってくるため、
  // 落とさないと済んだ注文が新しいカード利用通知の突合相手を取り合い、「一意に決まらない」を
  // 作って正当な突合を潰す（潰された候補はそのまま期限切れで未分類確定になる）
  const consumed = new Set<string>(
    await deps.transactionCandidateRepository.findMatchedAmazonOrderIds(
      userId,
      orders.map(o => o.amazonOrderId),
    ),
  )
  const freshOrders = orders.filter(o => !consumed.has(o.amazonOrderId))
  const alreadyMatchedCount = orders.length - freshOrders.length

  const window = amazonMatchWindowOf(freshOrders)
  const cardUsageCandidates =
    window === null
      ? []
      : await deps.transactionCandidateRepository.findEmailSourcedNormalCandidates(userId, {
          occurredFrom: window.from,
          occurredTo: window.to,
        })

  const outcomes = matchAmazonOrders({ orders: freshOrders, cardUsageCandidates })
  const matchedCandidateIds = new Set<string>()
  const expiredOrderIds: string[] = []
  let matchedCount = 0
  let pendingCount = 0
  let ambiguousCount = 0

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
      // 再走査で取り直すたびに同じ内容のイベントが出てしまう（突合済みの注文と候補はどちらも
      // 次の実行の対象から外れるため、突合の時点なら 1 回に収まる）。
      // 裏を返すと、保存の後にここが落ちるとこのイベントは二度と出ない（0 回になりうる）。
      // 購読者を足すときは、取引候補の amazon_matched 状態から作り直せる形にする
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
    if (judgeAmazonFirstTimeout(outcome.pending, at) === 'timeout_confirmed') {
      // 注文 ID は加盟店名・金額・商品名と違い、それ単体では買ったものを表さないので記録に残す。
      // 破棄したものが件数だけだと、後から「何が捨てられたか」を復元できない
      expiredOrderIds.push(outcome.pending.amazonOrderId)
      continue
    }
    pendingCount++
    if (outcome.pending.reason === 'ambiguous') ambiguousCount++
  }

  const cardUsageTimedOutCount = await confirmCardUsageTimeouts(deps, params, matchedCandidateIds)

  const summary: AmazonOrderMatchSummary = {
    parsedCount: orders.length,
    parseFailedCount,
    matchedCount,
    alreadyMatchedCount,
    pendingCount,
    ambiguousCount,
    expiredCount: expiredOrderIds.length,
    cardUsageTimedOutCount,
  }
  reportSummary(summary, importBatchId, expiredOrderIds)
  return summary
}

/**
 * カード利用通知が先に届いたまま Amazon の注文確認メールが 3 日届かなかった候補を、
 * 「Amazon 注文不明」の未分類確定へ遷移させる（SMBC 先着タイムアウト。V-2）。
 *
 * **この遷移は取り消せない**（`match_timeout` から通常・突合済みへ戻す遷移関数は無い）ため、
 * 「注文確認メールを取り直す機会をきちんと与えた候補」だけを対象にする。判定の上限は現在時刻
 * ではなく **この実行が取り直した期間の終わり**から数える。手動実行で期間を短く指定したときや、
 * 前の実行が残した古い期間を引き継いだときに、メールを 1 通も取っていない範囲の候補まで
 * 「注文不明」で閉じてしまうのを防ぐ（Gmail に注文確認メールがあるのに商品名が二度と付かなく
 * なり、しかも件数しか記録に残らない）。
 *
 * 取り直した期間がタイムアウト期限（3 日）に満たない実行では、そもそも突合の機会を与えられて
 * いないので掃き出しを丸ごと飛ばし、飛ばした事実を記録に残す。
 *
 * 期限より前の候補には触れない（まだ注文確認メールが届く見込みがある）。この実行で突合した
 * 候補も対象外にする（保存済みの kind は変わっているが、引き当てはこの実行の前に行うため）。
 *
 * 引く範囲には下限（`TIMEOUT_SWEEP_LOOKBACK_DAYS`）を置く。メール由来の候補は、取引になる
 * 仕組みがまだ無いぶん `normal` のまま溜まり続けるため、下限を置かないと毎日の取込が「その人の
 * 全履歴」を読み出して Zod で組み立て直すことになる（読む量が日を追って増える）。件数ではなく
 * 期間で区切るのは、件数上限だと古い非 Amazon の候補が枠を埋め続けて新しい候補に到達できなく
 * なるため。
 */
async function confirmCardUsageTimeouts(
  deps: AmazonOrderMatchDeps,
  params: AmazonOrderMatchParams,
  matchedCandidateIds: ReadonlySet<string>,
): Promise<number> {
  const { userId, targetPeriod, at, importBatchId } = params
  const coveredDays = (targetPeriod.to.getTime() - targetPeriod.from.getTime()) / MILLIS_PER_DAY
  if (coveredDays < AMAZON_MATCH_TIMEOUT_DAYS) {
    console.warn(
      `[transaction-import] メールを取り直した期間（${coveredDays.toFixed(1)} 日）が Amazon 突合の` +
        `タイムアウト（${AMAZON_MATCH_TIMEOUT_DAYS} 日）より短いため、注文不明の確定を見送った` +
        `（importBatchId=${importBatchId}）— 期限内の注文確認メールを取り直せておらず、` +
        '確定すると突合できるはずの支払いに商品名が付かなくなる',
    )
    return 0
  }

  // 取り直した期間の終わりと現在時刻の早いほうを起点にする（引き継いだ古い期間で、まだ
  // 取り直していない範囲まで閉じないため）
  const basis = targetPeriod.to.getTime() < at.getTime() ? targetPeriod.to : at
  const occurredTo = amazonMatchDeadlineBefore(basis)
  const expired = await deps.transactionCandidateRepository.findEmailSourcedNormalCandidates(
    userId,
    {
      occurredFrom: new Date(occurredTo.getTime() - TIMEOUT_SWEEP_LOOKBACK_DAYS * MILLIS_PER_DAY),
      occurredTo,
    },
  )
  const targets = expired.filter(
    (candidate: NormalTransactionCandidate) =>
      isAmazonMerchantName(candidate.common.merchantName) &&
      !matchedCandidateIds.has(candidate.common.transactionCandidateId) &&
      judgeSmbcFirstTimeout(candidate, basis) === 'timeout_confirmed',
  )
  for (const candidate of targets) {
    await deps.transactionCandidateRepository.save(
      confirmMatchTimeout(candidate, 'smbc_first_awaiting_amazon', at),
    )
  }
  return targets.length
}

/**
 * 突合の結果を記録に残す。読めなかったメールは本文構造が変わった合図なので警告として出す。
 *
 * 期限切れの破棄は警告にしない — ギフト券・ポイント・別のカードで払った注文はカード利用通知と
 * 決して突合しないため定常的に起き、警告にすると本当に追うべきパース失敗がその行に埋もれる。
 *
 * メール本文・商品名・金額・加盟店名は出さない（買ったものは PII に当たる）。件数と、破棄した
 * 注文の識別子だけを載せる。
 */
function reportSummary(
  summary: AmazonOrderMatchSummary,
  importBatchId: ImportBatchId,
  expiredOrderIds: readonly string[],
): void {
  const counts =
    `importBatchId=${importBatchId}, 読み取り=${summary.parsedCount}, ` +
    `突合=${summary.matchedCount}, 突合済みで読み飛ばし=${summary.alreadyMatchedCount}, ` +
    `保留=${summary.pendingCount}（うち一意に決まらない=${summary.ambiguousCount}）, ` +
    `期限切れ破棄=${summary.expiredCount}, 注文不明で未分類確定=${summary.cardUsageTimedOutCount}`
  if (summary.parseFailedCount > 0) {
    console.warn(
      `[transaction-import] Amazon 注文確認メールを読み取れなかった` +
        `（パース失敗=${summary.parseFailedCount}, ${counts}）— 本文構造が変わった可能性がある`,
    )
  }
  if (summary.expiredCount > 0) {
    console.info(
      `[transaction-import] 期限内に突合できなかった Amazon 注文を破棄した` +
        `（importBatchId=${importBatchId}, amazonOrderId=${expiredOrderIds.join(', ')}）`,
    )
  }
  if (
    summary.parseFailedCount === 0 &&
    (summary.parsedCount > 0 || summary.cardUsageTimedOutCount > 0)
  ) {
    console.info(`[transaction-import] Amazon 注文を突合した（${counts}）`)
  }
}
