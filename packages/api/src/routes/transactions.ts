import { Hono } from 'hono'
import { z } from 'zod'
import {
  ConfirmedClassificationSchema,
  InvariantViolationError,
  NotFoundError,
  PermissionDeniedError,
  CategoryIdSchema,
  ClassifiedDetailsSchema,
  TransactionIdSchema,
  TransactionManuallyClassifiedSchema,
  TransactionSchema,
  YearMonthSchema,
  ExpenseClassSchema,
  classify,
  createTransaction,
  deleteTransaction,
  normalizeMerchantName,
} from '@warimaru/domain'
import type {
  ClassifiedDetails,
  ConfirmedClassification,
  EventBus,
  Transaction,
  TransactionId,
  TransactionListQuery,
  TransactionListFilter,
  TransactionRepository,
  UserId,
  UserRole,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'
import { roleToPersonalExpenseClass } from '../role-mapping.js'

const ListParamsSchema = z.object({
  month: YearMonthSchema,
  expenseClass: ExpenseClassSchema.optional(),
  categoryId: CategoryIdSchema.optional(),
  isUnclassifiedOnly: z.enum(['true', 'false']).optional(),
})

const SummaryParamsSchema = z.object({
  month: YearMonthSchema,
})

// 不変条件（経費なら expenseTypeId 必須）は domain 側の確定分類スキーマに一元化する
const ClassificationInputSchema = ConfirmedClassificationSchema
type ClassificationInput = ConfirmedClassification

/** CSV パーサと同基準（金額 0 は不正） */
const AmountSchema = z
  .number()
  .int()
  .refine(value => value !== 0, { message: '金額 0 は許容しない' })

const CreateBodySchema = z.object({
  merchantName: z.string().min(1),
  amount: AmountSchema,
  occurredAt: z.coerce.date(),
  classification: ClassificationInputSchema.optional(),
})

const UpdateBodySchema = z
  .object({
    merchantName: z.string().min(1).optional(),
    amount: AmountSchema.optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .refine(
    body =>
      body.merchantName !== undefined || body.amount !== undefined || body.occurredAt !== undefined,
    { message: '更新対象のフィールドが 1 つ以上必要' },
  )

function buildManualDetails(
  input: ClassificationInput,
  viewerId: UserId,
  at: Date,
): ClassifiedDetails {
  return ClassifiedDetailsSchema.parse({
    categoryId: input.categoryId,
    expenseClass: input.expenseClass,
    expenseTypeRef:
      input.expenseClass === 'business_expense' && input.expenseTypeId !== undefined
        ? { kind: 'business', expenseTypeId: input.expenseTypeId }
        : { kind: 'non_business' },
    basis: { kind: 'user_manual', modifiedByUserId: viewerId, modifiedAt: at },
  })
}

function assertOwnedByViewer(transaction: Transaction, viewerId: UserId): void {
  if (transaction.common.ownerUserId !== viewerId) {
    throw new PermissionDeniedError('他ユーザーの取引は操作できない')
  }
}

export function transactionsRoutes(
  transactionListQuery: TransactionListQuery,
  transactionRepository: TransactionRepository,
  resolveViewerRole: (viewerId: UserId) => Promise<UserRole>,
  eventBus: EventBus,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** 手動分類の確定をイベントとして発行する（学習ルールへの反映は購読側 #34） */
  async function publishManuallyClassified(
    transactionId: TransactionId,
    viewerId: UserId,
    merchantName: string,
    input: ClassificationInput,
    at: Date,
  ): Promise<void> {
    await eventBus.publish(
      TransactionManuallyClassifiedSchema.parse({
        ...domainEventBase(at),
        type: 'TransactionManuallyClassified',
        transactionId,
        userId: viewerId,
        merchantName,
        confirmedClassification: {
          categoryId: input.categoryId,
          expenseClass: input.expenseClass,
          ...(input.expenseTypeId !== undefined ? { expenseTypeId: input.expenseTypeId } : {}),
        },
      }),
    )
  }

  app.get('/', async c => {
    const params = ListParamsSchema.parse({
      month: c.req.query('month'),
      expenseClass: c.req.query('expenseClass'),
      categoryId: c.req.query('categoryId'),
      isUnclassifiedOnly: c.req.query('isUnclassifiedOnly'),
    })
    const filter: TransactionListFilter = { month: params.month }
    if (params.expenseClass !== undefined) {
      filter.expenseClass = params.expenseClass
    }
    if (params.categoryId !== undefined) {
      filter.categoryId = params.categoryId
    }
    if (params.isUnclassifiedOnly !== undefined) {
      filter.isUnclassifiedOnly = params.isUnclassifiedOnly === 'true'
    }
    const viewerId = c.get('viewerId')
    const result = await transactionListQuery.fetch(viewerId, filter)
    return c.json(result)
  })

  app.get('/unclassified-summary', async c => {
    const params = SummaryParamsSchema.parse({ month: c.req.query('month') })
    const viewerId = c.get('viewerId')
    const result = await transactionListQuery.fetchUnclassifiedSummary(viewerId, params.month)
    return c.json(result)
  })

  app.post('/', async c => {
    const body = CreateBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const now = new Date()
    const common = {
      transactionId: TransactionIdSchema.parse(newUlid()),
      ownerUserId: viewerId,
      // 学習ルールの自然キーになるため、取込経路（CSV/PDF/メール）と同じ正規化を適用する（OQ-23）
      merchantName: normalizeMerchantName(body.merchantName),
      amount: body.amount,
      occurredAt: body.occurredAt,
      importSource: { kind: 'manual', enteredAt: now, enteredByUserId: viewerId },
    }
    const transaction =
      body.classification !== undefined
        ? createTransaction({
            kind: 'classified',
            common,
            details: buildManualDetails(body.classification, viewerId, now),
          })
        : createTransaction({
            kind: 'unclassified',
            common,
            reason: 'merchant_rule_unlearned',
            defaultExpenseClass: roleToPersonalExpenseClass(await resolveViewerRole(viewerId)),
          })
    await transactionRepository.save(transaction)
    if (body.classification !== undefined) {
      await publishManuallyClassified(
        common.transactionId,
        viewerId,
        common.merchantName,
        body.classification,
        now,
      )
    }
    return c.json(transaction, 201)
  })

  app.put('/:id', async c => {
    const id = TransactionIdSchema.parse(c.req.param('id'))
    const body = UpdateBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const transaction = await transactionRepository.findById(id)
    if (transaction === null) throw new NotFoundError('Transaction', id)
    assertOwnedByViewer(transaction, viewerId)
    if (transaction.kind === 'deleted') {
      throw new InvariantViolationError('削除済みの取引は編集できない')
    }
    const updated = TransactionSchema.parse({
      ...transaction,
      common: {
        ...transaction.common,
        ...(body.merchantName !== undefined
          ? { merchantName: normalizeMerchantName(body.merchantName) }
          : {}),
        ...(body.amount !== undefined ? { amount: body.amount } : {}),
        ...(body.occurredAt !== undefined ? { occurredAt: body.occurredAt } : {}),
      },
    })
    await transactionRepository.save(updated)
    return c.json(updated)
  })

  app.delete('/:id', async c => {
    const id = TransactionIdSchema.parse(c.req.param('id'))
    const viewerId = c.get('viewerId')
    const transaction = await transactionRepository.findById(id)
    if (transaction === null) throw new NotFoundError('Transaction', id)
    assertOwnedByViewer(transaction, viewerId)
    if (transaction.kind === 'deleted') {
      // 冪等: 既に削除済みなら現状を返す
      return c.json(transaction)
    }
    const deleted = deleteTransaction(transaction, 'user_deleted', new Date())
    await transactionRepository.save(deleted)
    return c.json(deleted)
  })

  app.put('/:id/classify', async c => {
    const id = TransactionIdSchema.parse(c.req.param('id'))
    const input = ClassificationInputSchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const transaction = await transactionRepository.findById(id)
    if (transaction === null) throw new NotFoundError('Transaction', id)
    assertOwnedByViewer(transaction, viewerId)
    if (transaction.kind === 'deleted') {
      throw new InvariantViolationError('削除済みの取引は分類できない')
    }
    const now = new Date()
    const details = buildManualDetails(input, viewerId, now)
    const isFirstConfirmation = transaction.kind === 'unclassified'
    const classified = isFirstConfirmation
      ? classify(transaction, details)
      : createTransaction({ kind: 'classified', common: transaction.common, details })
    await transactionRepository.save(classified)
    // イベント発行は未分類→分類済みの確定（08c「未分類取引を分類して確定する」）に限定する。
    // 分類済み取引の再分類はカテゴリ／費用区分手動修正イベント + L-4 のユーザー選択
    // （既存ルールの上書き判定: 「以後このルールに従う」/「今回限り」）を運ぶ別チェーンで
    // 扱う（後続 Issue）。ここで発行すると学習ルールが選択なしに上書きされてしまう。
    if (isFirstConfirmation) {
      await publishManuallyClassified(id, viewerId, transaction.common.merchantName, input, now)
    }
    return c.json(classified)
  })

  return app
}
