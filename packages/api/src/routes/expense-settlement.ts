import { Hono } from 'hono'
import { z } from 'zod'
import {
  ExpenseDepositMatchedSchema,
  ExpenseReimbursementDepositSchema,
  ExpenseReimbursementIdSchema,
  InvariantViolationError,
  MonthlyExpenseCycleFinalizedSchema,
  MonthlyExpenseCycleIdSchema,
  MonthlyExpenseCycleSchema,
  NotFoundError,
  PermissionDeniedError,
  ProratedChildTransactionSchema,
  UnapprovedExpenseTransferSchema,
  YearMonthSchema,
  calculateSettlementMatchDifference,
  confirmCycleCsv,
  finalizeCycle,
  matchDeposit,
} from '@warimaru/domain'
import type {
  EventBus,
  ExpenseReimbursementDeposit,
  ExpenseReimbursementDepositRepository,
  ExpenseSettlementManagementQuery,
  MonthlyExpenseCycle,
  MonthlyExpenseCycleRepository,
  ProratedChildRef,
  ProratedChildTransactionRepository,
  UserId,
  UserRole,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'
import { roleToPersonalExpenseClass } from '../role-mapping.js'

const QueryParamsSchema = z.object({
  month: YearMonthSchema.optional(),
})

const CycleCreateBodySchema = z.object({
  targetMonth: YearMonthSchema,
})

const FinalizeBodySchema = z.object({
  expenseReimbursementId: ExpenseReimbursementIdSchema,
  unapprovedTransfers: z
    .array(UnapprovedExpenseTransferSchema.omit({ transferredAt: true }))
    .optional(),
})

const DepositBodySchema = z.object({
  depositAmount: z.number().int().positive(),
  depositedAt: z.coerce.date().optional(),
})

export interface ExpenseSettlementRoutesDeps {
  expenseSettlementManagementQuery: ExpenseSettlementManagementQuery
  monthlyExpenseCycleRepository: MonthlyExpenseCycleRepository
  proratedChildTransactionRepository: ProratedChildTransactionRepository
  expenseReimbursementDepositRepository: ExpenseReimbursementDepositRepository
  resolveViewerRole: (viewerId: UserId) => Promise<UserRole>
  eventBus: EventBus
}

function assertCycleOwnedByViewer(cycle: MonthlyExpenseCycle, viewerId: UserId): void {
  if (cycle.common.userId !== viewerId) {
    throw new PermissionDeniedError('他ユーザーの経費精算サイクルは操作できない')
  }
}

export function expenseSettlementRoutes(deps: ExpenseSettlementRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /**
   * サイクル最終確定の成立をイベントとして発行する（#34 チェーン5）。
   * 配信は at-least-once（復旧パスの再実行でも発行する）。月次レポートの
   * 最終確定昇格（#43）は MonthlyExpenseCycleFinalized の購読側で実装する。
   */
  async function publishCycleFinalized(
    cycle: Extract<MonthlyExpenseCycle, { kind: 'finalized' }>,
    deposit: ExpenseReimbursementDeposit,
    at: Date,
  ): Promise<void> {
    await deps.eventBus.publish(
      MonthlyExpenseCycleFinalizedSchema.parse({
        ...domainEventBase(at),
        type: 'MonthlyExpenseCycleFinalized',
        monthlyExpenseCycleId: cycle.common.monthlyExpenseCycleId,
        finalizedAt: cycle.finalizedAt,
      }),
    )
    await deps.eventBus.publish(
      ExpenseDepositMatchedSchema.parse({
        ...domainEventBase(at),
        type: 'ExpenseDepositMatched',
        expenseReimbursementId: deposit.common.expenseReimbursementId,
        monthlyExpenseCycleId: cycle.common.monthlyExpenseCycleId,
        difference: calculateSettlementMatchDifference(cycle, deposit.common.depositAmount),
      }),
    )
  }

  app.get('/', async c => {
    const params = QueryParamsSchema.parse({ month: c.req.query('month') })
    const viewerId = c.get('viewerId')
    const result = await deps.expenseSettlementManagementQuery.fetch(viewerId, params.month)
    return c.json(result)
  })

  /** 対象月のサイクル取得（Web の確定操作 UI がサイクル ID と状態を得るために使う） */
  app.get('/cycles', async c => {
    const params = z.object({ month: YearMonthSchema }).parse({ month: c.req.query('month') })
    const viewerId = c.get('viewerId')
    const cycle = await deps.monthlyExpenseCycleRepository.findByUserAndMonth(
      viewerId,
      params.month,
    )
    return c.json({ cycle })
  })

  /** 月次経費精算サイクルの開始 */
  app.post('/cycles', async c => {
    const body = CycleCreateBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const existing = await deps.monthlyExpenseCycleRepository.findByUserAndMonth(
      viewerId,
      body.targetMonth,
    )
    if (existing !== null) {
      throw new InvariantViolationError(
        `対象年月のサイクルが既に存在する: ${body.targetMonth}（${existing.common.monthlyExpenseCycleId}）`,
      )
    }
    const cycle = MonthlyExpenseCycleSchema.parse({
      kind: 'accumulating',
      common: {
        monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema.parse(newUlid()),
        userId: viewerId,
        targetYearMonth: body.targetMonth,
        cycleStartedAt: new Date(),
        accumulations: [],
        childTransactionRefs: [],
      },
    })
    await deps.monthlyExpenseCycleRepository.save(cycle)
    return c.json(cycle, 201)
  })

  /** サイクルの CSV 確定（集積中 → CSV確定） */
  app.put('/cycles/:id/confirm-csv', async c => {
    const id = MonthlyExpenseCycleIdSchema.parse(c.req.param('id'))
    const viewerId = c.get('viewerId')
    const cycle = await deps.monthlyExpenseCycleRepository.findById(id)
    if (cycle === null) throw new NotFoundError('MonthlyExpenseCycle', id)
    assertCycleOwnedByViewer(cycle, viewerId)
    if (cycle.kind !== 'accumulating') {
      throw new InvariantViolationError(
        `集積中でないサイクルは CSV 確定できない（現状態: ${cycle.kind}）`,
      )
    }
    const confirmed = confirmCycleCsv(cycle, new Date())
    await deps.monthlyExpenseCycleRepository.save(confirmed)
    return c.json(confirmed)
  })

  /**
   * サイクルの最終確定（精算入金との突合を含む）。
   *
   * サイクル保存と入金保存はトランザクションで括れない（Neon HTTP ドライバ方針）ため、
   * 「サイクル確定 → 入金突合」の順で保存し、間で失敗しても同一リクエストの再実行で
   * 突合だけを完了できる冪等・復旧可能なフローとする。
   */
  app.put('/cycles/:id/finalize', async c => {
    const id = MonthlyExpenseCycleIdSchema.parse(c.req.param('id'))
    const body = FinalizeBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')

    const cycle = await deps.monthlyExpenseCycleRepository.findById(id)
    if (cycle === null) throw new NotFoundError('MonthlyExpenseCycle', id)
    assertCycleOwnedByViewer(cycle, viewerId)

    const deposit = await deps.expenseReimbursementDepositRepository.findById(
      body.expenseReimbursementId,
    )
    if (deposit === null) {
      throw new NotFoundError('ExpenseReimbursementDeposit', body.expenseReimbursementId)
    }
    if (deposit.common.userId !== viewerId) {
      throw new PermissionDeniedError('他ユーザーの精算入金は突合できない')
    }

    if (cycle.kind === 'finalized') {
      if (cycle.expenseReimbursementId !== body.expenseReimbursementId) {
        throw new InvariantViolationError(
          `サイクルは別の精算入金で確定済み: ${cycle.expenseReimbursementId}`,
        )
      }
      if (
        deposit.kind !== 'awaiting_match' &&
        deposit.matchedCycleId === cycle.common.monthlyExpenseCycleId
      ) {
        // 完全冪等リプレイ: 双方確定済みなら現状を返す
        return c.json({ cycle, deposit })
      }
      if (deposit.kind === 'awaiting_match') {
        // 復旧パス: サイクル保存後・入金保存前に失敗したケース。突合のみ完了させる
        // （unapprovedTransfers は確定済みサイクルの値が正のため body の値は使わない）
        const now = new Date()
        const matched = matchDeposit(deposit, cycle.common.monthlyExpenseCycleId, now)
        await deps.expenseReimbursementDepositRepository.save(matched)
        await publishCycleFinalized(cycle, matched, now)
        return c.json({ cycle, deposit: matched })
      }
      throw new InvariantViolationError(
        `入金は別サイクルと突合済みのため確定を完了できない（現状態: ${deposit.kind}）`,
      )
    }
    if (cycle.kind !== 'csv_confirmed') {
      throw new InvariantViolationError(
        `CSV 確定済みでないサイクルは最終確定できない（現状態: ${cycle.kind}）`,
      )
    }
    if (deposit.kind !== 'awaiting_match') {
      throw new InvariantViolationError(
        `突合待ちでない入金は使用できない（現状態: ${deposit.kind}）`,
      )
    }

    const now = new Date()
    const transfers = (body.unapprovedTransfers ?? []).map(transfer =>
      UnapprovedExpenseTransferSchema.parse({
        originalBusinessExpenseTransactionId: transfer.originalBusinessExpenseTransactionId,
        transferTarget: transfer.transferTarget,
        transferAmount: transfer.transferAmount,
        transferredAt: now,
      }),
    )
    const finalized = finalizeCycle(cycle, body.expenseReimbursementId, transfers, now)
    const matched = matchDeposit(deposit, cycle.common.monthlyExpenseCycleId, now)
    await deps.monthlyExpenseCycleRepository.save(finalized)
    await deps.expenseReimbursementDepositRepository.save(matched)
    await publishCycleFinalized(finalized, matched, now)
    return c.json({ cycle: finalized, deposit: matched })
  })

  /** 精算入金の記録（突合待ちとして登録） */
  app.post('/deposits', async c => {
    const body = DepositBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const now = new Date()
    const deposit = ExpenseReimbursementDepositSchema.parse({
      kind: 'awaiting_match',
      common: {
        expenseReimbursementId: ExpenseReimbursementIdSchema.parse(newUlid()),
        userId: viewerId,
        depositAmount: body.depositAmount,
        depositedAt: body.depositedAt ?? now,
      },
      receivedAt: now,
    })
    await deps.expenseReimbursementDepositRepository.save(deposit)
    return c.json(deposit, 201)
  })

  /** 突合待ち入金の一覧 */
  app.get('/deposits/awaiting', async c => {
    const viewerId = c.get('viewerId')
    const items = await deps.expenseReimbursementDepositRepository.findAwaitingByUser(viewerId)
    return c.json({ items })
  })

  /** 按分子取引の自動生成トリガー（上限超過の部分充当から子取引を導出） */
  app.post('/cycles/:id/prorate', async c => {
    const id = MonthlyExpenseCycleIdSchema.parse(c.req.param('id'))
    const viewerId = c.get('viewerId')
    const cycle = await deps.monthlyExpenseCycleRepository.findById(id)
    if (cycle === null) throw new NotFoundError('MonthlyExpenseCycle', id)
    assertCycleOwnedByViewer(cycle, viewerId)

    const personalExpenseClass = roleToPersonalExpenseClass(await deps.resolveViewerRole(viewerId))
    const now = new Date()
    const knownRefs = new Set(cycle.common.childTransactionRefs.map(ref => ref.childTransactionId))
    const newRefs: ProratedChildRef[] = []
    let generatedCount = 0

    for (const accumulation of cycle.common.accumulations) {
      for (const ref of accumulation.transactionRefs) {
        if (ref.allocation.kind !== 'partial') continue
        const childTransactionId = ref.allocation.childTransactionId
        const existing = await deps.proratedChildTransactionRepository.findById(childTransactionId)
        if (existing === null) {
          const child = ProratedChildTransactionSchema.parse({
            childTransactionId,
            parentTransactionId: ref.transactionId,
            userId: viewerId,
            personalAmount: ref.allocation.personalAllocatedAmount,
            personalExpenseClass,
            derivedAt: now,
            prorationBasis: {
              kind: 'cap_excess_fifo',
              monthlyExpenseCycleId: cycle.common.monthlyExpenseCycleId,
              proratedAt: now,
              // 超過発生時点の上限残 = 当該取引で経費に充当できた金額
              capRemainderAtExcess: ref.allocation.expenseAllocatedAmount,
            },
          })
          await deps.proratedChildTransactionRepository.save(child)
          generatedCount++
        }
        if (!knownRefs.has(childTransactionId)) {
          newRefs.push({ childTransactionId, parentTransactionId: ref.transactionId })
          knownRefs.add(childTransactionId)
        }
      }
    }

    let updatedCycle: MonthlyExpenseCycle = cycle
    if (newRefs.length > 0) {
      updatedCycle = MonthlyExpenseCycleSchema.parse({
        ...cycle,
        common: {
          ...cycle.common,
          childTransactionRefs: [...cycle.common.childTransactionRefs, ...newRefs],
        },
      })
      await deps.monthlyExpenseCycleRepository.save(updatedCycle)
    }
    return c.json({ cycle: updatedCycle, generatedCount })
  })

  return app
}
