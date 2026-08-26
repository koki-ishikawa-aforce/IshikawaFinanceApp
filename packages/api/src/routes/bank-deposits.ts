import { Hono } from 'hono'
import { z } from 'zod'
import {
  BankDepositIdSchema,
  DeterminedDepositPurposeSchema,
  ExpenseReimbursementIdSchema,
  NotFoundError,
  canViewBankDeposit,
  canViewEmployerRemitterDirectory,
  confirmBankDepositPurpose,
  emptyEmployerRemitterDirectory,
  isRegisteredEmployerRemitter,
  registerEmployerRemitterFromDeposit,
} from '@warimaru/domain'
import type {
  BankDeposit,
  BankDepositRepository,
  EmployerRemitterDirectoryRepository,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import type { AppEnv } from '../env.js'
import {
  applyDeterminedBankDepositPurpose,
  type BankDepositPurposeServiceDeps,
} from '../balance/bank-deposit-purpose-service.js'
import { readJsonObjectBody } from '../read-json-object-body.js'

const ConfirmPurposeBodySchema = z.object({
  purpose: DeterminedDepositPurposeSchema,
  /**
   * この入金の振込元を、以後も勤務先からの入金として扱う（勤務先振込元名簿へ登録する）。
   * 既定は登録しない。勤務先の登録経路はこの窓口 1 本に閉じる（#448 / OQ-61 ①）
   */
  registerRemitterAsEmployer: z.boolean().default(false),
})

export interface BankDepositsRoutesDeps extends BankDepositPurposeServiceDeps {
  bankDepositRepository: BankDepositRepository
  employerRemitterDirectoryRepository: EmployerRemitterDirectoryRepository
}

/** 一覧・確定応答の表現。集約の内部形をそのまま返さず、画面が使う値だけを載せる */
function toAwaitingView(
  deposit: BankDeposit,
  employerRemitterRegistered: boolean,
): {
  bankDepositId: string
  amount: number
  occurredAt: Date
  remitterName: string
  employerRemitterRegistered: boolean
} {
  return {
    bankDepositId: deposit.common.bankDepositId,
    amount: deposit.common.amount,
    occurredAt: deposit.common.occurredAt,
    remitterName: deposit.common.remitterName,
    // 既に覚えている振込元に「今後も勤務先として扱う」を出しても意味がないため、
    // 画面が出し分けられるよう登録済みかどうかを添える（#448）
    employerRemitterRegistered,
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
 *
 * 確定と同時に、その振込元を「以後も勤務先からの入金として扱う」と覚えさせられる
 * （#448 / OQ-61）。勤務先振込元名の登録経路はこの窓口 1 本に閉じており、設定画面での
 * 手入力は作らない。覚えた名前は次の入金から自動判別の入口
 * （`determineBankDepositPurposeForUser`）で使われ、同じ振込元は手動確認に落ちなくなる。
 */
export function bankDepositsRoutes(deps: BankDepositsRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** 手動確認待ちの入金一覧（本人分のみ） */
  app.get('/awaiting', async c => {
    const viewerId = c.get('viewerId')
    // 入金一覧と名簿は互いに独立なので同時に引く（サーバーレスの DB 往復を 1 回ぶん減らす）
    const [deposits, stored] = await Promise.all([
      deps.bankDepositRepository.findAwaitingManualConfirmationByUser(viewerId),
      deps.employerRemitterDirectoryRepository.findByOwner(viewerId),
    ])
    // Repository は本人分だけを引くが、絞り込み漏れがそのまま露出にならないよう
    // ドメイン側の可視判定でも通す（プライバシー3段階ルール）
    const directory = canViewEmployerRemitterDirectory(stored, viewerId)
      ? stored
      : emptyEmployerRemitterDirectory(viewerId)
    return c.json({
      deposits: deposits
        .filter(d => canViewBankDeposit(d, viewerId))
        .map(d =>
          toAwaitingView(d, isRegisteredEmployerRemitter(directory, d.common.remitterName)),
        ),
    })
  })

  /** 用途を手動で確定する（本人のみ・用途不明の入金のみ） */
  app.post('/:bankDepositId/purpose', async c => {
    const bankDepositId = BankDepositIdSchema.parse(c.req.param('bankDepositId'))
    const body = ConfirmPurposeBodySchema.parse(readJsonObjectBody(await c.req.text()))
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
    // 登録の可否（勤務先からの入金として確定したか・本人か）は**何も書く前に**確かめる。
    // 保存後に弾くと、用途は確定済みなのに続く反映（シャドウ残高の減算・イベント発行）へ
    // 進めない状態が残り、同じ本文で再送しても毎回同じ地点で弾かれて前方回復できない
    const registered = body.registerRemitterAsEmployer
      ? registerEmployerRemitterFromDeposit(
          await deps.employerRemitterDirectoryRepository.findByOwner(viewerId),
          { deposit: confirmed, operatorUserId: viewerId, at: now },
        )
      : null

    await deps.bankDepositRepository.save(confirmed)

    // 名簿へ書くのは確定を保存できたあと。確定しなかった入金の振込元を覚えてしまうと、
    // 以後その振込元が本人の確認を経ずに給与・経費精算へ倒れる。別集約への順次保存のため
    // ここで失敗すると「確定済みだが未登録」が残るが、同じ用途での確定し直し（反映の
    // 前方回復と同じ入口）が登録まで到達させる（登録は冪等）
    if (registered !== null) {
      await deps.employerRemitterDirectoryRepository.save(registered)
    }

    await applyDeterminedBankDepositPurpose(deps, confirmed, now)

    return c.json({
      bankDepositId,
      purpose: confirmed.kind,
      employerRemitterRegistered: body.registerRemitterAsEmployer,
    })
  })

  return app
}
