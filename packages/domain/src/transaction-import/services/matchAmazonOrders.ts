/**
 * Amazon 注文と SMBC カード利用通知の突合（08a §2「Amazon注文とSMBCカード利用通知を突合する」）
 *
 * behavior Amazon注文とSMBCカード利用通知を突合する = Amazon注文情報 AND List<カード利用通知>
 *   -> Amazon突合取引候補 OR Amazon突合保留
 *
 * カード利用通知からは「AMAZON CO JP・2,420 円」しか分からないため、同じ金額の注文確認メールと
 * 結び付けて商品名を補う。手がかりは**金額の完全一致とタイミング**（OQ-17）で、実測では
 * 7/15 09:53 の注文確認に対してカード利用通知が同日 14:37（約 4.7 時間差）だった。
 *
 * 判定の規則:
 *  - 加盟店名が Amazon を指し（`isAmazonMerchantName`）、金額が注文合計と完全一致し、
 *    発生日時が注文の受信日時から**前後 3 日以内**のカード利用通知を突合の相手候補とする。
 *    前後どちらも見るのは、どちらが先に届くか決まらないため（双方向 3 日のタイムアウトは
 *    まさにその両方向を指す）。
 *  - **相手候補が互いに一意に決まる組み合わせだけを突合する。** 1 つの注文に当たる候補が複数
 *    ある場合も、1 つの候補に当たる注文が複数ある場合も突合しない（同日同金額の注文が複数
 *    あるときに、どちらの商品名を紐付けても誤りうるため）。突合しなかったものは保留になり、
 *    タイムアウトまで未分類のまま残る。
 *
 * 突合しない側に倒すのは、誤った紐付けが家計簿に残るほうが、商品名が出ないことより害が大きい
 * ため（金額は正しいまま未分類として残るだけで、後から手で分類できる）。
 *
 * ドメインの純粋関数（zod のみ・I/O 依存なし）。現在時刻・候補の一覧は呼出し側が渡す。
 */
import type { AmazonOrderInfo } from '../value-objects/AmazonOrderInfo'
import {
  AmazonMatchPendingSchema,
  type AmazonMatchPending,
} from '../value-objects/AmazonMatchPending'
import { isAmazonMerchantName } from '../value-objects/NormalizedMerchantName'
import type { NormalTransactionCandidate } from '../aggregates/TransactionCandidate'

/** 双方向タイムアウトの日数（3 日。#391 の確定済み仕様） */
export const AMAZON_MATCH_TIMEOUT_DAYS = 3

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000

/** 注文の受信日時から見たタイムアウト期限 */
export function amazonMatchTimeoutAt(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + AMAZON_MATCH_TIMEOUT_DAYS * MILLIS_PER_DAY)
}

/**
 * 渡した注文すべての突合相手が入りうる発生日時の範囲（各注文の前後 3 日を包む）。
 *
 * 呼出し側が「どこまで候補を引けばよいか」を自前で計算すると、期間の解釈がドメインの外に
 * 散る。注文が 1 件も無ければ引く必要が無いので null を返す。
 */
export function amazonMatchWindowOf(
  orders: readonly AmazonOrderInfo[],
): { from: Date; to: Date } | null {
  const times = orders.map(o => o.orderedAt.getTime())
  if (times.length === 0) return null
  const span = AMAZON_MATCH_TIMEOUT_DAYS * MILLIS_PER_DAY
  return { from: new Date(Math.min(...times) - span), to: new Date(Math.max(...times) + span) }
}

/**
 * この時刻から見て、発生日時がこれより前なら SMBC 先着タイムアウトに達している境界。
 * 掃き出し対象を引く上限として使う。
 */
export function amazonMatchDeadlineBefore(at: Date): Date {
  return new Date(at.getTime() - AMAZON_MATCH_TIMEOUT_DAYS * MILLIS_PER_DAY)
}

/** 突合の結末（08a §2 の `Amazon突合取引候補 OR Amazon突合保留`） */
export type AmazonOrderMatchOutcome =
  | {
      kind: 'matched'
      order: AmazonOrderInfo
      /** 商品名を紐付ける相手のカード利用通知由来の候補 */
      candidate: NormalTransactionCandidate
    }
  | { kind: 'pending'; order: AmazonOrderInfo; pending: AmazonMatchPending }

export interface AmazonOrderMatchInput {
  orders: readonly AmazonOrderInfo[]
  /** 突合の相手になりうる未確定のカード利用通知由来の候補 */
  cardUsageCandidates: readonly NormalTransactionCandidate[]
}

/** 注文と候補が持ち主・金額・期間の条件で対になりうるか */
function isMatchable(order: AmazonOrderInfo, candidate: NormalTransactionCandidate): boolean {
  // 持ち主が違う組み合わせは突合しない。夫婦 2 人ぶんの取込が同じ関数を通るため、ここを
  // 呼出し側の絞り込みだけに任せると、相手の買い物の商品名が本人の候補に載りうる
  if (candidate.common.userId !== order.userId) return false
  if (!isAmazonMerchantName(candidate.common.merchantName)) return false
  // 0 円の注文（ギフト券・ポイントで全額まかなった注文）はカードに請求が起きないため、
  // 突き合わせる相手が存在しない。同じ 0 円で届くカード利用通知（与信確認）と結び付けると、
  // 買い物と関係のない通知に商品名が付く
  if (order.orderTotal === 0) return false
  if (candidate.common.amount !== order.orderTotal) return false
  const lag = Math.abs(candidate.common.occurredAt.getTime() - order.orderedAt.getTime())
  return lag <= AMAZON_MATCH_TIMEOUT_DAYS * MILLIS_PER_DAY
}

function pendingOf(
  order: AmazonOrderInfo,
  reason: AmazonMatchPending['reason'],
): AmazonMatchPending {
  return AmazonMatchPendingSchema.parse({
    amazonOrderId: order.amazonOrderId,
    receivedAt: order.orderedAt,
    timeoutAt: amazonMatchTimeoutAt(order.orderedAt),
    reason,
  })
}

/**
 * 注文ごとの結末を、渡された順に返す。
 *
 * 一意性は注文と候補の両側で見る。ある注文に当たる候補がちょうど 1 つで、かつその候補に当たる
 * 注文もその注文だけのときにのみ突合する。
 */
export function matchAmazonOrders(input: AmazonOrderMatchInput): AmazonOrderMatchOutcome[] {
  const { orders, cardUsageCandidates } = input
  const matchable = orders.map(order => cardUsageCandidates.filter(c => isMatchable(order, c)))

  return orders.map((order, i) => {
    const candidates = matchable[i] ?? []
    if (candidates.length === 0)
      return { kind: 'pending', order, pending: pendingOf(order, 'card_usage_not_arrived') }
    if (candidates.length > 1)
      return { kind: 'pending', order, pending: pendingOf(order, 'ambiguous') }

    const candidate = candidates[0]
    if (candidate === undefined)
      return { kind: 'pending', order, pending: pendingOf(order, 'ambiguous') }
    const contendedBy = matchable.filter(
      (others, j) =>
        j !== i &&
        others.some(
          o => o.common.transactionCandidateId === candidate.common.transactionCandidateId,
        ),
    )
    if (contendedBy.length > 0)
      return { kind: 'pending', order, pending: pendingOf(order, 'ambiguous') }
    return { kind: 'matched', order, candidate }
  })
}

/**
 * タイムアウト判定（08b §2「Amazon突合タイムアウトを判定する」）。
 *
 * 判定は 2 方向あり、名前は `TimeoutDirection` の語彙に揃える。取引候補の段階では取引がまだ
 * 存在しないため、判定そのものは取引取込側に置く（08b は取引ID を前提にしている）。
 */
export type AmazonMatchTimeoutJudgment = 'timeout_confirmed' | 'waiting'

/**
 * Amazon 先着（注文確認メールが先に届き、カード利用通知が来ない）側の判定。
 * 確定したら注文情報を破棄する（配送キャンセルの可能性があるため取引候補にしない）。
 */
export function judgeAmazonFirstTimeout(
  pending: AmazonMatchPending,
  at: Date,
): AmazonMatchTimeoutJudgment {
  return at.getTime() >= pending.timeoutAt.getTime() ? 'timeout_confirmed' : 'waiting'
}

/**
 * SMBC 先着（カード利用通知が先に届き、注文確認メールが来ない）側の判定。
 *
 * 期限は発生日時から 3 日。確定したら「Amazon 注文不明」として未分類を確定させる（V-2）ため、
 * 呼出し側は `confirmMatchTimeout` で候補を遷移させる。
 */
export function judgeSmbcFirstTimeout(
  candidate: NormalTransactionCandidate,
  at: Date,
): AmazonMatchTimeoutJudgment {
  return at.getTime() >= amazonMatchTimeoutAt(candidate.common.occurredAt).getTime()
    ? 'timeout_confirmed'
    : 'waiting'
}
