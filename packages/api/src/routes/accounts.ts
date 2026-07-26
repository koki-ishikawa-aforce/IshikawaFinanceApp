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
 */
import { Hono } from 'hono'
import { z } from 'zod'
import {
  AccountIdSchema,
  AccountRegisteredSchema,
  BankNameChangedSchema,
  BankNameSchema,
  BrokerageNameChangedSchema,
  BrokerageNameSchema,
  InitialBalanceRegisteredSchema,
  MoneySchema,
  NotFoundError,
  PermissionDeniedError,
  asNisaAccount,
  asOtherSavingsAccount,
  changeBankName,
  changeBrokerageName,
  registerNisaAccount,
  registerOtherSavingsAccount,
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

  return app
}
