/**
 * API レスポンスのワイヤー形式スキーマ。
 * サーバーは c.json() で Date を ISO 文字列に直列化するため、
 * ドメインの z.date() スキーマは流用できず z.coerce.date() で受ける。
 */
import { z } from 'zod'

const IsoDate = z.coerce.date()

export const ExpenseClassWireSchema = z.enum([
  'household',
  'personal_honey',
  'personal_darling',
  'business_expense',
])
export type ExpenseClassWire = z.infer<typeof ExpenseClassWireSchema>

export const PersonalExpenseClassWireSchema = z.enum(['personal_honey', 'personal_darling'])

/** ミューテーションの戻り値を使わない場合のプレースホルダ */
export const UnknownResponseSchema = z.unknown()

// ---------- 取引一覧（#26） ----------

export const TransactionListItemWireSchema = z.object({
  transactionId: z.string(),
  occurredAt: IsoDate,
  expenseClass: ExpenseClassWireSchema,
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  merchantName: z.string().nullable(),
  amount: z.number().nullable(),
  isUnclassified: z.boolean(),
})
export type TransactionListItemWire = z.infer<typeof TransactionListItemWireSchema>

export const TransactionListWireSchema = z.array(TransactionListItemWireSchema)

export const UnclassifiedSummaryWireSchema = z.object({
  count: z.number().int(),
  recentIds: z.array(z.string()),
})
export type UnclassifiedSummaryWire = z.infer<typeof UnclassifiedSummaryWireSchema>

// ---------- 月次レポート（#27） ----------

const BalanceTrendPointWire = z.object({ date: IsoDate }).passthrough()

export const MonthlyReportViewWireSchema = z.object({
  status: z.enum(['csv_confirmed', 'finalized']),
  common: z.object({
    monthlyReportId: z.string(),
    targetYearMonth: z.string(),
    householdCategoryTotals: z.array(z.object({ categoryId: z.string(), total: z.number() })),
    personalTotalHoney: z.number(),
    personalTotalDarling: z.number(),
    // A②: 経費(会社)合計は閲覧者本人分のみ。配偶者分は API レスポンスに含まれない
    businessExpenseTotalSelf: z.number(),
    nisaContributionAccumulated: z.number(),
    balanceTrend: z.object({
      smbcBalanceTrend: z.array(BalanceTrendPointWire),
      otherSavingsBalanceTrend: z.array(BalanceTrendPointWire),
      nisaContributionTrend: z.array(BalanceTrendPointWire),
      cardUnpaidTrend: z.array(BalanceTrendPointWire),
    }),
    isIncompleteMonth: z.boolean().optional(),
  }),
  csvConfirmedAt: IsoDate,
  finalizedAt: IsoDate.nullable(),
  unapprovedTransfers: z
    .array(
      z.object({
        originalBusinessExpenseTransactionId: z.string(),
        transferTarget: PersonalExpenseClassWireSchema,
        transferAmount: z.number(),
        transferredAt: IsoDate,
      }),
    )
    .nullable(),
})
export type MonthlyReportViewWire = z.infer<typeof MonthlyReportViewWireSchema>

// ---------- 口座残高・資産推移（#28） ----------

export const AccountBalanceItemWireSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('smbc_bank'),
    accountId: z.string(),
    displayName: z.string(),
    currentBalance: z.number(),
    lastUpdatedAt: IsoDate,
  }),
  z.object({
    kind: z.literal('mitsui_sumitomo_card'),
    accountId: z.string(),
    displayName: z.string(),
    currentMonthUnpaidTotal: z.number(),
    lastSettledAt: IsoDate.nullable(),
  }),
  z.object({
    kind: z.literal('other_savings'),
    accountId: z.string(),
    displayName: z.string(),
    currentBalance: z.number(),
    lastUpdatedAt: IsoDate,
    daysSinceLastUpdate: z.number().int(),
  }),
  z.object({
    kind: z.literal('nisa'),
    accountId: z.string(),
    displayName: z.string(),
    currentAccumulated: z.number(),
    lastUpdatedAt: IsoDate,
  }),
])
export type AccountBalanceItemWire = z.infer<typeof AccountBalanceItemWireSchema>

export const AccountBalanceListWireSchema = z.object({
  items: z.array(AccountBalanceItemWireSchema),
})

export const AssetTotalWireSchema = z.object({
  asOf: IsoDate,
  smbcBalance: z.number(),
  otherSavingsBalance: z.number(),
  nisaContributionAccumulated: z.number(),
  cardUnpaidTotal: z.number(),
  total: z.number(),
})
export type AssetTotalWire = z.infer<typeof AssetTotalWireSchema>

const BalancePointWire = z.object({ date: IsoDate, amount: z.number() })
export type BalancePointWire = z.infer<typeof BalancePointWire>

export const BalanceTimeSeriesWireSchema = z.object({
  yearMonthRange: z.object({ from: z.string(), to: z.string() }),
  smbc: z.array(BalancePointWire),
  otherSavings: z.array(BalancePointWire),
  nisaContribution: z.array(BalancePointWire),
  cardUnpaid: z.array(BalancePointWire),
})
export type BalanceTimeSeriesWire = z.infer<typeof BalanceTimeSeriesWireSchema>

// ---------- 経費精算（#29） ----------

export const ExpenseAllocationWireSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }),
  z.object({
    kind: z.literal('partial'),
    expenseAllocatedAmount: z.number(),
    personalAllocatedAmount: z.number(),
    childTransactionId: z.string(),
  }),
])

export const ExpenseTransactionRefWireSchema = z.object({
  transactionId: z.string(),
  occurredAt: IsoDate,
  amount: z.number(),
  allocation: ExpenseAllocationWireSchema,
})
export type ExpenseTransactionRefWire = z.infer<typeof ExpenseTransactionRefWireSchema>

export const ExpenseTypeAccumulationWireSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('capped'),
    accumulationId: z.string(),
    expenseTypeId: z.string(),
    userId: z.string(),
    monthlyCap: z.number(),
    currentTotal: z.number(),
    capReached: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('not_reached') }),
      z.object({
        kind: z.literal('reached'),
        reachedAt: IsoDate,
        reachingTransactionId: z.string(),
      }),
    ]),
    transactionRefs: z.array(ExpenseTransactionRefWireSchema),
  }),
  z.object({
    kind: z.literal('unlimited'),
    accumulationId: z.string(),
    expenseTypeId: z.string(),
    userId: z.string(),
    currentTotal: z.number(),
    transactionRefs: z.array(ExpenseTransactionRefWireSchema),
  }),
])
export type ExpenseTypeAccumulationWire = z.infer<typeof ExpenseTypeAccumulationWireSchema>

export const ProratedChildTransactionWireSchema = z.object({
  childTransactionId: z.string(),
  parentTransactionId: z.string(),
  userId: z.string(),
  personalAmount: z.number(),
  personalExpenseClass: PersonalExpenseClassWireSchema,
  derivedAt: IsoDate,
  prorationBasis: z.object({ kind: z.string() }).passthrough(),
})
export type ProratedChildTransactionWire = z.infer<typeof ProratedChildTransactionWireSchema>

export const ExpenseSettlementViewWireSchema = z.object({
  userId: z.string(),
  currentAccumulations: z.array(ExpenseTypeAccumulationWireSchema),
  currentChildTransactions: z.array(ProratedChildTransactionWireSchema),
  latestFinalizedCycle: z
    .object({
      monthlyExpenseCycleId: z.string(),
      targetYearMonth: z.string(),
      finalizedAt: IsoDate,
      unapprovedTotal: z.number(),
    })
    .nullable(),
})
export type ExpenseSettlementViewWire = z.infer<typeof ExpenseSettlementViewWireSchema>

export const CycleWireSchema = z.object({
  kind: z.enum(['accumulating', 'csv_confirmed', 'finalized']),
  common: z
    .object({
      monthlyExpenseCycleId: z.string(),
      targetYearMonth: z.string(),
      cycleStartedAt: IsoDate,
    })
    .passthrough(),
})
export type CycleWire = z.infer<typeof CycleWireSchema>

export const CurrentCycleResponseSchema = z.object({
  cycle: CycleWireSchema.nullable(),
})

export const DepositWireSchema = z.object({
  kind: z.enum(['awaiting_match', 'matched', 'unrecognized_confirmed']),
  common: z.object({
    expenseReimbursementId: z.string(),
    userId: z.string(),
    depositAmount: z.number(),
    depositedAt: IsoDate,
  }),
})
export type DepositWire = z.infer<typeof DepositWireSchema>

export const DepositListWireSchema = z.object({
  items: z.array(DepositWireSchema),
})

// ---------- CSV 取込（#30） ----------

export const ImportJobWireSchema = z.object({
  kind: z.enum([
    'upload_accepted',
    'pdf_converting',
    'format_validating',
    'importing',
    'completed',
    'failed',
  ]),
  common: z.object({
    importJobId: z.string(),
    targetMonth: z.string(),
    fileKind: z.string(),
    fileFormat: z.string(),
    fileRef: z.string(),
  }),
  summary: z
    .object({
      newCount: z.number().int(),
      autoClassifiedEstimateCount: z.number().int(),
      unclassifiedEstimateCount: z.number().int(),
      duplicateExcludedCount: z.number().int(),
    })
    .optional(),
  failure: z.object({ kind: z.string(), failureDetail: z.string() }).passthrough().optional(),
})
export type ImportJobWire = z.infer<typeof ImportJobWireSchema>

export const CsvUploadResponseSchema = z.object({ job: ImportJobWireSchema })

export const CandidateWireSchema = z.object({
  kind: z.enum(['normal', 'amazon_matched', 'match_timeout', 'confirmed']),
  common: z.object({
    transactionCandidateId: z.string(),
    userId: z.string(),
    merchantName: z.string(),
    amount: z.number(),
    occurredAt: IsoDate,
  }),
})
export type CandidateWire = z.infer<typeof CandidateWireSchema>

export const CandidatesResponseSchema = z.object({
  importJobId: z.string(),
  jobKind: z.string(),
  candidates: z.array(CandidateWireSchema),
})

export const ConfirmResponseSchema = z.object({
  importJobId: z.string(),
  confirmedCount: z.number().int(),
  alreadyConfirmedCount: z.number().int(),
  confirmedAt: IsoDate,
})

export const ImportStatusResponseSchema = z.object({
  completion: z
    .object({
      userId: z.string(),
      targetMonth: z.string(),
      importJobId: z.string(),
      completedAt: IsoDate,
    })
    .nullable(),
})
export type ImportStatusResponse = z.infer<typeof ImportStatusResponseSchema>

// ---------- マスタ管理（#32） ----------

const OwnershipScopeWire = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('household_shared') }),
  z.object({ kind: z.literal('personal'), userId: z.string() }),
])

export const CategoryWireSchema = z.object({
  kind: z.enum(['default', 'custom']),
  categoryId: z.string(),
  name: z.string(),
  scope: OwnershipScopeWire,
})
export type CategoryWire = z.infer<typeof CategoryWireSchema>

export const CategoryListWireSchema = z.object({ items: z.array(CategoryWireSchema) })

export const ExpenseTypeWireSchema = z.object({
  kind: z.enum(['default', 'custom']),
  expenseTypeId: z.string(),
  name: z.string(),
  scope: OwnershipScopeWire,
})
export type ExpenseTypeWire = z.infer<typeof ExpenseTypeWireSchema>

export const ExpenseTypeListWireSchema = z.object({ items: z.array(ExpenseTypeWireSchema) })

export const MonthlyLimitWireSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('capped'),
    monthlyLimitId: z.string(),
    userId: z.string(),
    expenseTypeId: z.string(),
    effectiveFrom: IsoDate,
    capAmount: z.number(),
    changeHistory: z.array(
      z
        .object({
          oldCapAmount: z.number(),
          newCapAmount: z.number(),
          changedAt: IsoDate,
        })
        .passthrough(),
    ),
  }),
  z.object({
    kind: z.literal('unlimited'),
    monthlyLimitId: z.string(),
    userId: z.string(),
    expenseTypeId: z.string(),
    effectiveFrom: IsoDate,
  }),
])
export type MonthlyLimitWire = z.infer<typeof MonthlyLimitWireSchema>

export const MonthlyLimitListWireSchema = z.object({
  items: z.array(MonthlyLimitWireSchema),
})

// ---------- オンボーディング（#42） ----------

const LineOperationSettingsWireSchema = z.object({
  friendAdd: z.object({ kind: z.enum(['not_added', 'added']) }),
  notificationActivation: z.object({ kind: z.enum(['not_activated', 'activated']) }),
})
export type LineOperationSettingsWire = z.infer<typeof LineOperationSettingsWireSchema>

/**
 * 共通トークルーム参加状態（世帯レベル）のワイヤー形式。
 * 参加は世帯にひとつの事実のため、per-user の LINE 運用設定ではなく世帯の記録として返る。
 */
const SharedTalkRoomWireSchema = z.object({
  kind: z.enum(['not_joined', 'joined']),
})
export type SharedTalkRoomWire = z.infer<typeof SharedTalkRoomWireSchema>

const Phase2ProgressWireSchema = z.object({
  sectionA: z.object({ kind: z.enum(['not_started', 'completed']) }),
  sectionB: z.object({ kind: z.enum(['not_started', 'completed']) }),
  sectionF: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('not_started') }),
    z.object({ kind: z.literal('skipped') }),
    z.object({ kind: z.literal('completed'), importJobId: z.string() }),
  ]),
})

const AppUserCommonWireSchema = z.object({
  userId: z.string(),
  role: z.enum(['honey', 'darling']),
  nickname: z.string().optional(),
  firstRegisteredAt: IsoDate,
  lineOperationSettings: LineOperationSettingsWireSchema.optional(),
})

/** AppUser 集約のワイヤー形式（kind ごとの必須フィールドはドメインの discriminated union をミラー） */
export const AppUserWireSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('phase1_completed'), common: AppUserCommonWireSchema }),
  z.object({
    kind: z.literal('phase2_in_progress'),
    common: AppUserCommonWireSchema,
    progress: Phase2ProgressWireSchema,
  }),
  z.object({ kind: z.literal('phase2_completed'), common: AppUserCommonWireSchema }),
  z.object({
    kind: z.literal('operation_started'),
    common: AppUserCommonWireSchema,
    lineOperationSettings: LineOperationSettingsWireSchema,
  }),
])
export type AppUserWire = z.infer<typeof AppUserWireSchema>

/** AppUser のみを返すエンドポイント（register / nickname / phase2 各種）のレスポンス */
export const OnboardingUserWireSchema = z.object({ user: AppUserWireSchema.nullable() })

/**
 * 世帯レベルの共通トークルーム参加状態を併せて返すレスポンス
 * （GET /me と POST /phase1/talk-room）。
 */
export const OnboardingMeWireSchema = z.object({
  user: AppUserWireSchema.nullable(),
  sharedTalkRoom: SharedTalkRoomWireSchema,
})

export const SpouseCompletionResultWireSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('awaiting_spouse'),
    userId: z.string(),
    spouseUserId: z.string(),
    detectedAt: IsoDate,
  }),
  z.object({
    kind: z.literal('both_completed'),
    honeyUserId: z.string(),
    darlingUserId: z.string(),
    bothCompletedAt: IsoDate,
  }),
])
export type SpouseCompletionResultWire = z.infer<typeof SpouseCompletionResultWireSchema>

export const GmailAuthorizeResponseSchema = z.object({ authorizationUrl: z.string() })

// ---------- 共通 ----------

export const MeWireSchema = z.object({
  viewerId: z.string(),
  role: z.enum(['honey', 'darling']),
})
export type MeWire = z.infer<typeof MeWireSchema>

// ---------- 設定（#48: プロフィール / 口座管理） ----------

export const SettingsProfileWireSchema = z.object({
  profile: z.object({
    userId: z.string(),
    role: z.enum(['honey', 'darling']),
    nickname: z.string().nullable(),
  }),
})
export type SettingsProfileWire = z.infer<typeof SettingsProfileWireSchema>

export const BrokerageNameWireSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sbi') }),
  z.object({ kind: z.literal('rakuten') }),
  z.object({ kind: z.literal('other'), customName: z.string() }),
])
export type BrokerageNameWire = z.infer<typeof BrokerageNameWireSchema>

const OwnAccountCommonWire = z.object({
  accountId: z.string(),
  ownerUserId: z.string(),
  activeness: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('active') }),
    z.object({ kind: z.literal('inactive'), inactivatedAt: IsoDate, reason: z.string() }),
  ]),
})

export const OwnAccountWireSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('smbc_bank'),
    common: OwnAccountCommonWire,
    balance: z.object({ currentBalance: z.number() }).passthrough(),
  }),
  z.object({
    kind: z.literal('mitsui_sumitomo_card'),
    common: OwnAccountCommonWire,
  }),
  z.object({
    kind: z.literal('other_savings'),
    common: OwnAccountCommonWire,
    bankName: z.string(),
    balance: z.object({ currentBalance: z.number() }).passthrough(),
  }),
  z.object({
    kind: z.literal('nisa'),
    common: OwnAccountCommonWire,
    brokerageName: BrokerageNameWireSchema,
    contribution: z.object({ currentAccumulated: z.number() }).passthrough(),
  }),
])
export type OwnAccountWire = z.infer<typeof OwnAccountWireSchema>

export const OwnAccountListWireSchema = z.object({ items: z.array(OwnAccountWireSchema) })
