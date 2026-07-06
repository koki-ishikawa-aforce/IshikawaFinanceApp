/**
 * 取引候補 Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * 重複除外: findByGmailMessageId（Gmail_message_ID 完全一致）と
 * findByTripleMatch（発生日 + 金額 + 加盟店名〔NFKC 正規化済み〕、OQ-23 / OQ-7）で
 * 生成前チェックを行う（Phase 5 M-B）。
 */
import type { TransactionCandidateId, UserId, GmailMessageId } from '../../shared/ids'
import type { Money } from '../../shared/value-objects/Money'
import type { TransactionCandidate } from '../aggregates/TransactionCandidate'

export interface TransactionCandidateRepository {
  findById(id: TransactionCandidateId): Promise<TransactionCandidate | null>
  findByGmailMessageId(gmailMessageId: GmailMessageId): Promise<TransactionCandidate | null>
  findByTripleMatch(
    userId: UserId,
    occurredOn: Date,
    amount: Money,
    merchantName: string,
  ): Promise<TransactionCandidate | null>
  save(candidate: TransactionCandidate): Promise<void>
}
