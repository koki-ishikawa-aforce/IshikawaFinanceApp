/**
 * 口座管理エンドポイント（#48、残高・資産推移管理コンテキスト）
 * @see docs/domain/08d-ul-残高資産推移管理.md §2
 * @see docs/superpowers/specs/2026-05-01-phase3.5-ux-ui-design.md §13（別銀行貯蓄: 銀行名 /
 *      NISA: 証券会社名が編集可。三井住友系は固定のため登録・編集の対象外）
 *
 * - 一覧は viewer 本人が所有する口座のみ（世帯合算の残高表示は /api/balances が担う）
 * - 「同一ユーザー × 口座種別の一意性」は Repository.save の一意制約が最終保証（409 に翻訳）
 * - 銀行名・証券会社名の変更は所有者本人のみ（ドメイン関数 changeBankName /
 *   changeBrokerageName が操作者を検証し、error-handler が 403 に翻訳する）
 * - 残高の手動操作（#397。取り崩し・補正・初期残高の後修正・非アクティブ化）も所有者本人のみ。
 *   金額と残高の不変条件（1 円以上・負残高にしない）はドメイン関数が持ち、本ルートでは
 *   再実装しない（400 / 409 への翻訳は error-handler が行う）
 */
import { Hono } from 'hono'
import { z } from 'zod'
import {
  AccountIdSchema,
  AccountInactivatedSchema,
  AccountRegisteredSchema,
  BankNameChangedSchema,
  BankNameSchema,
  BrokerageNameChangedSchema,
  BrokerageNameSchema,
  InitialBalanceCorrectedSchema,
  InitialBalanceRegisteredSchema,
  InvariantViolationError,
  MoneySchema,
  NisaContributionAddedSchema,
  NotFoundError,
  OtherSavingsBalanceUpdatedSchema,
  PermissionDeniedError,
  addNisaContributionBySmbcTransfer,
  addOtherSavingsBySmbcTransfer,
  asNisaAccount,
  asOtherSavingsAccount,
  changeBankName,
  changeBrokerageName,
  correctInitialBalance,
  correctOtherSavingsBalance,
  inactivateAccount,
  initialBalanceOf,
  registerNisaAccount,
  registerOtherSavingsAccount,
  withdrawOtherSavings,
} from '@warimaru/domain'
import type { Account, AccountId, AccountRepository, EventBus, UserId } from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'

const RegisterBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('other_savings'),
    bankName: BankNameSchema,
    initialBalance: MoneySchema,
  }),
  z.object({
    kind: z.literal('nisa'),
    brokerageName: BrokerageNameSchema,
    initialAccumulated: MoneySchema,
  }),
])
const BankNameBodySchema = z.object({ bankName: BankNameSchema })
const BrokerageNameBodySchema = z.object({ brokerageName: BrokerageNameSchema })
const AmountBodySchema = z.object({ amount: MoneySchema })
const BalanceBodySchema = z.object({ balance: MoneySchema })
const InitialBalanceBodySchema = z.object({ initialBalance: MoneySchema })
const InactivateBodySchema = z.object({ reason: z.string().min(1) })

export interface AccountsRoutesDeps {
  accountRepository: AccountRepository
  eventBus: EventBus
}

export function accountsRoutes(deps: AccountsRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  async function getAccountOr404(id: AccountId): Promise<Account> {
    const account = await deps.accountRepository.findById(id)
    if (account === null) throw new NotFoundError('Account', id)
    return account
  }

  /**
   * 口座種別で絞り込む前に所有者を検証する。非所有者には種別の絞り込み結果
   * （存在・口座種別）が漏れないよう、所有権チェックを先行させる（08d §2、本人のみ変更可）。
   */
  function assertOwnedByViewer(account: Account, viewerId: UserId): void {
    if (account.common.ownerUserId !== viewerId) {
      throw new PermissionDeniedError('他ユーザーの口座は操作できない')
    }
  }

  /** 自分が所有する口座の一覧 */
  app.get('/', async c => {
    const items = await deps.accountRepository.findByOwner(c.get('viewerId'))
    return c.json({ items })
  })

  /**
   * 口座の登録（別銀行貯蓄 / NISA）。三井住友系（SMBC 銀行・カード）は取込基盤側で
   * 管理するため対象外。同種別の重複登録は一意制約により 409。
   */
  app.post('/', async c => {
    const body = RegisterBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const now = new Date()
    const accountId = AccountIdSchema.parse(newUlid())
    const account =
      body.kind === 'other_savings'
        ? registerOtherSavingsAccount({
            accountId,
            ownerUserId: viewerId,
            bankName: body.bankName,
            initialBalance: body.initialBalance,
            at: now,
          })
        : registerNisaAccount({
            accountId,
            ownerUserId: viewerId,
            brokerageName: body.brokerageName,
            initialAccumulated: body.initialAccumulated,
            at: now,
          })
    await deps.accountRepository.save(account)
    await deps.eventBus.publish(
      AccountRegisteredSchema.parse({
        ...domainEventBase(now),
        type: 'AccountRegistered',
        userId: viewerId,
        accountId,
        accountKind: account.kind,
      }),
    )
    // 登録は UL の「口座をアプリに登録する」+「初期残高を登録する」の統合アクション（08d §2）
    await deps.eventBus.publish(
      InitialBalanceRegisteredSchema.parse({
        ...domainEventBase(now),
        type: 'InitialBalanceRegistered',
        userId: viewerId,
        accountId,
        initialBalance:
          body.kind === 'other_savings' ? body.initialBalance : body.initialAccumulated,
      }),
    )
    return c.json({ account }, 201)
  })

  /** 別銀行貯蓄口座の銀行名変更（所有者本人のみ） */
  app.put('/:accountId/bank-name', async c => {
    const body = BankNameBodySchema.parse(await c.req.json())
    const accountId = AccountIdSchema.parse(c.req.param('accountId'))
    const viewerId = c.get('viewerId')
    const found = await getAccountOr404(accountId)
    assertOwnedByViewer(found, viewerId)
    const account = asOtherSavingsAccount(found)
    const now = new Date()
    const oldBankName = account.bankName
    const updated = changeBankName(account, body.bankName, viewerId)
    await deps.accountRepository.save(updated)
    await deps.eventBus.publish(
      BankNameChangedSchema.parse({
        ...domainEventBase(now),
        type: 'BankNameChanged',
        accountId,
        oldBankName,
        newBankName: body.bankName,
        changedByUserId: viewerId,
        changedAt: now,
      }),
    )
    return c.json({ account: updated })
  })

  /** NISA 口座の証券会社名変更（所有者本人のみ） */
  app.put('/:accountId/brokerage-name', async c => {
    const body = BrokerageNameBodySchema.parse(await c.req.json())
    const accountId = AccountIdSchema.parse(c.req.param('accountId'))
    const viewerId = c.get('viewerId')
    const found = await getAccountOr404(accountId)
    assertOwnedByViewer(found, viewerId)
    const account = asNisaAccount(found)
    const now = new Date()
    const oldBrokerageName = account.brokerageName
    const updated = changeBrokerageName(account, body.brokerageName, viewerId)
    await deps.accountRepository.save(updated)
    await deps.eventBus.publish(
      BrokerageNameChangedSchema.parse({
        ...domainEventBase(now),
        type: 'BrokerageNameChanged',
        accountId,
        oldBrokerageName,
        newBrokerageName: body.brokerageName,
        changedByUserId: viewerId,
        changedAt: now,
      }),
    )
    return c.json({ account: updated })
  })

  // --- #397: 残高の手動操作 ---

  /** 所有者本人であることを確かめたうえで口座を取り出す（手動操作系の共通前処理） */
  async function loadOwnedAccount(c: {
    req: { param: (k: string) => string | undefined }
    get: (k: 'viewerId') => UserId
  }): Promise<{ account: Account; viewerId: UserId; accountId: AccountId }> {
    const accountId = AccountIdSchema.parse(c.req.param('accountId'))
    const viewerId = c.get('viewerId')
    const account = await getAccountOr404(accountId)
    assertOwnedByViewer(account, viewerId)
    return { account, viewerId, accountId }
  }

  /** 別銀行貯蓄残高更新イベント（08d §3）の発行 */
  async function publishOtherSavingsUpdated(params: {
    accountId: AccountId
    delta: number
    newBalance: number
    source: 'smbc_transfer_addition' | 'manual_withdrawal' | 'manual_correction'
    at: Date
  }): Promise<void> {
    await deps.eventBus.publish(
      OtherSavingsBalanceUpdatedSchema.parse({
        ...domainEventBase(params.at),
        type: 'OtherSavingsBalanceUpdated',
        accountId: params.accountId,
        delta: params.delta,
        newBalance: params.newBalance,
        source: params.source,
      }),
    )
  }

  /**
   * SMBC からの振込による加算（別銀行貯蓄 = 貯蓄への振込 / NISA = 積立の買い付け）。
   * 口座種別で振る舞いが分かれる（08d §2 の 2 つの behavior）。
   */
  app.post('/:accountId/transfer-in', async c => {
    const body = AmountBodySchema.parse(await c.req.json())
    const { account, accountId } = await loadOwnedAccount(c)
    const now = new Date()

    if (account.kind === 'other_savings') {
      const updated = addOtherSavingsBySmbcTransfer(account, { amount: body.amount, at: now })
      await deps.accountRepository.save(updated)
      await publishOtherSavingsUpdated({
        accountId,
        delta: body.amount,
        newBalance: updated.balance.currentBalance,
        source: 'smbc_transfer_addition',
        at: now,
      })
      return c.json({ account: updated })
    }
    if (account.kind === 'nisa') {
      const updated = addNisaContributionBySmbcTransfer(account, { amount: body.amount, at: now })
      await deps.accountRepository.save(updated)
      await deps.eventBus.publish(
        NisaContributionAddedSchema.parse({
          ...domainEventBase(now),
          type: 'NisaContributionAdded',
          accountId,
          addedAmount: body.amount,
          newAccumulated: updated.contribution.currentAccumulated,
          brokerageName: updated.brokerageName,
        }),
      )
      return c.json({ account: updated })
    }
    throw new InvariantViolationError(
      `振込による加算は別銀行貯蓄・NISA 口座のみ（現種別: ${account.kind}）`,
    )
  })

  /** 取り崩しの記録（別銀行貯蓄。所有者本人のみ、残高を超える取り崩しは 409） */
  app.post('/:accountId/withdraw', async c => {
    const body = AmountBodySchema.parse(await c.req.json())
    const { account, viewerId, accountId } = await loadOwnedAccount(c)
    const savings = asOtherSavingsAccount(account)
    const now = new Date()
    const updated = withdrawOtherSavings(savings, {
      amount: body.amount,
      operatorUserId: viewerId,
      at: now,
    })
    await deps.accountRepository.save(updated)
    await publishOtherSavingsUpdated({
      accountId,
      delta: -body.amount,
      newBalance: updated.balance.currentBalance,
      source: 'manual_withdrawal',
      at: now,
    })
    return c.json({ account: updated })
  })

  /** 残高の手動補正（別銀行貯蓄。差分ではなく実際の残高へ差し替える） */
  app.put('/:accountId/balance', async c => {
    const body = BalanceBodySchema.parse(await c.req.json())
    const { account, viewerId, accountId } = await loadOwnedAccount(c)
    const savings = asOtherSavingsAccount(account)
    const now = new Date()
    const updated = correctOtherSavingsBalance(savings, {
      correctedBalance: body.balance,
      operatorUserId: viewerId,
      at: now,
    })
    await deps.accountRepository.save(updated)
    await publishOtherSavingsUpdated({
      accountId,
      delta: updated.balance.currentBalance - savings.balance.currentBalance,
      newBalance: updated.balance.currentBalance,
      source: 'manual_correction',
      at: now,
    })
    return c.json({ account: updated })
  })

  /** 初期残高の後修正（オンボーディング Phase 2-B の入力ミスを直す。現在残高も同じ差分ずれる） */
  app.put('/:accountId/initial-balance', async c => {
    const body = InitialBalanceBodySchema.parse(await c.req.json())
    const { account, viewerId, accountId } = await loadOwnedAccount(c)
    const oldInitialBalance = initialBalanceOf(account)
    const now = new Date()
    const updated = correctInitialBalance(account, {
      initialBalance: body.initialBalance,
      operatorUserId: viewerId,
      at: now,
    })
    await deps.accountRepository.save(updated)
    await deps.eventBus.publish(
      InitialBalanceCorrectedSchema.parse({
        ...domainEventBase(now),
        type: 'InitialBalanceCorrected',
        accountId,
        // correctInitialBalance を通った時点で初期残高を持つ種別に限られる（カードは 409）
        oldInitialBalance,
        newInitialBalance: body.initialBalance,
        correctedByUserId: viewerId,
      }),
    )
    return c.json({ account: updated })
  })

  /** 口座の非アクティブ化（以降この口座は残高一覧・資産合計から外れる） */
  app.post('/:accountId/inactivate', async c => {
    const body = InactivateBodySchema.parse(await c.req.json())
    const { account, accountId } = await loadOwnedAccount(c)
    const now = new Date()
    const updated = inactivateAccount(account, { reason: body.reason, at: now })
    await deps.accountRepository.save(updated)
    await deps.eventBus.publish(
      AccountInactivatedSchema.parse({
        ...domainEventBase(now),
        type: 'AccountInactivated',
        accountId,
        reason: body.reason,
      }),
    )
    return c.json({ account: updated })
  })

  return app
}
