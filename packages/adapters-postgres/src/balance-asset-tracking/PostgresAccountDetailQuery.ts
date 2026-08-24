/**
 * AccountDetailQuery の PostgreSQL 実装（#406）
 * @see docs/superpowers/specs/2026-05-01-phase3.5-ux-ui-design.md §9.3
 *
 * 口座 1 件の「いまの値・その口座だけの推移・その口座の履歴」を返す。
 *
 * 可視判定はドメイン（`canViewAccountDetail`）に置き、所有者以外には null を返す。
 * 「他人の口座」と「存在しない口座」を同じ null にするのは、応答の違いから配偶者の
 * 口座の有無を数えられないようにするため。
 *
 * 値の正は口座種別ごとに違う。SMBC 銀行・別銀行貯蓄は口座の残高、NISA は積立累計、
 * カードは未払金集約（口座は残高を持たない。08d §1）。推移と履歴はどの種別でも
 * 残高変動履歴（#398）から読む。
 */
import { and, eq } from 'drizzle-orm'
import type {
  Account,
  AccountDetailQuery,
  AccountDetailView,
  AccountId,
  ManualEntryAnnotation,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import {
  AccountDetailViewSchema,
  AccountSchema,
  MitsuiSumitomoUnpaidSchema,
  acceptsBalanceManualEntry,
  accountBalanceHistoryRows,
  accountBalanceSeriesOfAxis,
  accountDisplayName,
  balanceAxisOfAccountKind,
  canViewAccountDetail,
  jstMonthStart,
  jstNextMonthStart,
} from '@warimaru/domain'
import type { Db } from '../client'
import { accounts, mitsuiSumitomoUnpaids } from '../schema'
import { parsePayload } from '../serialize'
import { PostgresBalanceHistoryRepository } from './PostgresBalanceHistoryRepository'

/** 履歴の行に添える手入力記録。手入力を受け付けない口座種別は空 */
function manualEntriesOf(account: Account): ManualEntryAnnotation[] {
  if (account.kind === 'other_savings') return [...account.balance.manualEntries]
  if (account.kind === 'nisa') return [...account.contribution.manualEntries]
  return []
}

export class PostgresAccountDetailQuery implements AccountDetailQuery {
  private readonly history: PostgresBalanceHistoryRepository

  constructor(private readonly db: Db) {
    this.history = new PostgresBalanceHistoryRepository(db)
  }

  async fetch(
    viewerId: UserId,
    accountId: AccountId,
    from: YearMonth,
    to: YearMonth,
  ): Promise<AccountDetailView | null> {
    const rows = await this.db
      .select({ payload: accounts.payload, unpaidPayload: mitsuiSumitomoUnpaids.payload })
      .from(accounts)
      .leftJoin(mitsuiSumitomoUnpaids, eq(mitsuiSumitomoUnpaids.accountId, accounts.accountId))
      // 絞り込みは SQL 側でも所有者で閉じる（残高一覧 PostgresAccountBalanceQuery と同じ扱い）。
      // 可視判定の正は下のドメイン関数だが、そこが将来ゆるんだときに
      // 「口座IDだけで世帯外まで引ける入口」にならないよう二重にかける
      .where(and(eq(accounts.accountId, accountId), eq(accounts.ownerUserId, viewerId)))
    const row = rows[0]
    if (row === undefined) return null

    const account = parsePayload(AccountSchema, row.payload)
    if (!canViewAccountDetail(account, viewerId)) return null

    const axis = balanceAxisOfAccountKind(account.kind)
    const windowStart = jstMonthStart(from)
    // 本番は 1 文 = 1 往復（neon-http）のため、期間内の変動と期間の起点は並行に読む
    const [entries, opening] = await Promise.all([
      this.history.findByAccountAxisAndOccurredAtRange(
        accountId,
        axis,
        windowStart,
        jstNextMonthStart(to),
      ),
      this.history.findLatestForAccountAxisBefore(accountId, axis, windowStart),
    ])

    const unpaid =
      row.unpaidPayload === null
        ? null
        : parsePayload(MitsuiSumitomoUnpaidSchema, row.unpaidPayload)

    return AccountDetailViewSchema.parse({
      accountId,
      kind: account.kind,
      displayName: accountDisplayName(account),
      isActive: account.common.activeness.kind === 'active',
      currentValue: currentValueOf(account, unpaid),
      lastUpdatedAt: lastUpdatedAtOf(account, unpaid),
      // 口座種別での分岐はドメインに置く。画面で条件分岐せず View が答えることで、
      // 口座種別が増えたときにボタンの出し分けだけ取り残されないようにする
      supportsBalanceManualEntry: acceptsBalanceManualEntry(account),
      yearMonthRange: { from, to },
      series: accountBalanceSeriesOfAxis({ entries, accountId, axis, opening, windowStart }).map(
        point => ({ date: point.occurredAt, amount: point.value }),
      ),
      // 画面は新しい順に並べる。ドメインは発生日時の昇順で返すため、ここで反転する
      history: accountBalanceHistoryRows({
        entries,
        accountId,
        axis,
        opening,
        manualEntries: manualEntriesOf(account),
      }).reverse(),
    })
  }
}

function currentValueOf(
  account: Account,
  unpaid: { currentMonthUnpaidTotal: number } | null,
): number {
  switch (account.kind) {
    case 'smbc_bank':
    case 'other_savings':
      return account.balance.currentBalance
    case 'nisa':
      return account.contribution.currentAccumulated
    case 'mitsui_sumitomo_card':
      // 集約参照上 unpaid は必ず存在するはずだが、欠損時は 0 にフォールバック（防御。
      // 残高一覧 PostgresAccountBalanceQuery と同じ扱い）
      return unpaid === null ? 0 : unpaid.currentMonthUnpaidTotal
  }
}

function lastUpdatedAtOf(
  account: Account,
  unpaid: { lastSettledAt: Date | null } | null,
): Date | null {
  switch (account.kind) {
    case 'smbc_bank':
    case 'other_savings':
      return account.balance.lastUpdatedAt
    case 'nisa':
      return account.contribution.lastUpdatedAt
    case 'mitsui_sumitomo_card':
      // カードは「前回の精算日」。一度も精算していなければ null のまま返す
      return unpaid === null ? null : unpaid.lastSettledAt
  }
}
