import { Hono } from 'hono'
import { z } from 'zod'
import {
  BankDepositIdSchema,
  DeterminedDepositPurposeSchema,
  ExpenseReimbursementIdSchema,
  NotFoundError,
  confirmBankDepositPurpose,
} from '@warimaru/domain'
import type { BankDeposit, BankDepositRepository } from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import type { AppEnv } from '../env.js'
import {
  applyDeterminedBankDepositPurpose,
  type BankDepositPurposeServiceDeps,
} from '../balance/bank-deposit-purpose-service.js'

const ConfirmPurposeBodySchema = z.object({
  purpose: DeterminedDepositPurposeSchema,
})

export interface BankDepositsRoutesDeps extends BankDepositPurposeServiceDeps {
  bankDepositRepository: BankDepositRepository
}

/** 一覧・確定応答の表現。集約の内部形をそのまま返さず、画面が使う値だけを載せる */
function toAwaitingView(deposit: BankDeposit): {
  bankDepositId: string
  amount: number
  occurredAt: Date
  remitterName: string
} {
  return {
    bankDepositId: deposit.common.bankDepositId,
    amount: deposit.common.amount,
    occurredAt: deposit.common.occurredAt,
    remitterName: deposit.common.remitterName,
  }
}

/**
 * 銀行入金の用途の手動確認（08d §1「暫定処理 = 手動確認待ち」、#390）
 *
 * 入金日と金額の 2 シグナルが矛盾して自動確定できなかった入金（OQ-21 ③）を、
 * ユーザー本人が給与 / 経費精算入金 / 別銀行戻し のいずれかに確定する経路。
 *
 * プライバシー: 給与額・経費精算入金は個人に閉じる情報のため、参照も確定も本人のみ。
 * 一覧は viewer 自身の分だけを引き、確定時の所有者検証は集約
 * （`confirmBankDepositPurpose`）が行う（API 層で不変条件を再実装しない）。
 */
export function bankDepositsRoutes(deps: BankDepositsRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** 手動確認待ちの入金一覧（本人分のみ） */
  app.get('/awaiting', async c => {
    const viewerId = c.get('viewerId')
    const deposits = await deps.bankDepositRepository.findAwaitingManualConfirmationByUser(viewerId)
    return c.json({ deposits: deposits.map(toAwaitingView) })
  })

  /** 用途を手動で確定する（本人のみ・用途不明の入金のみ） */
  app.post('/:bankDepositId/purpose', async c => {
    const bankDepositId = BankDepositIdSchema.parse(c.req.param('bankDepositId'))
    const body = ConfirmPurposeBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const now = new Date()

    const deposit = await deps.bankDepositRepository.findById(bankDepositId)
    if (deposit === null) {
      throw new NotFoundError('銀行入金', bankDepositId)
    }

    const confirmed = confirmBankDepositPurpose(deposit, {
      purpose: body.purpose,
      operatorUserId: viewerId,
      // 経費精算入金として確定したときだけ使われる（08d §1 経費精算入金判別）。
      // 集約が保持するため、突合起動イベントを再発行しても同じ ID になる
      expenseReimbursementId: ExpenseReimbursementIdSchema.parse(newUlid()),
      at: now,
    })
    await deps.bankDepositRepository.save(confirmed)
    await applyDeterminedBankDepositPurpose(deps, confirmed, now)

    return c.json({ bankDepositId, purpose: confirmed.kind })
  })

  return app
}
