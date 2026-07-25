import 'dotenv/config'
import { createDbConnection } from '../src/client'
import { isProductionNodeEnv } from '../src/nodeEnv'
import * as schema from '../src/schema'
import { serializeForPayload } from '../src/serialize'

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required. Set it in .env or environment.')
  process.exit(1)
}

// 接続先が Neon なら neon-http、ローカルの素の PostgreSQL なら node-postgres (#323)
const connection = createDbConnection({
  databaseUrl: DATABASE_URL,
  isProduction: isProductionNodeEnv(process.env['NODE_ENV']),
  driverOverride: process.env['DATABASE_DRIVER'],
})
const db = connection.db

const NOW = new Date('2026-07-15T03:00:00.000Z')

const HONEY_ID = 'U_HONEY_DEV'
const DARLING_ID = 'U_DARLING_DEV'

const TALK_ROOM_ID = 'TR_DEV_001'

const CAT_HOUSING = '01JAAAAAAAAAAAAAAAAAAAAAA1'
const CAT_FOOD = '01JAAAAAAAAAAAAAAAAAAAAAA2'
const CAT_ENTERTAINMENT = '01JAAAAAAAAAAAAAAAAAAAAAA3'
const CAT_OTHER = '01JAAAAAAAAAAAAAAAAAAAAAA4'

const ACCT_HONEY_SMBC = '01JBBBBBBBBBBBBBBBBBBBBBB1'
const ACCT_HONEY_CARD = '01JBBBBBBBBBBBBBBBBBBBBBB2'
const ACCT_HONEY_NISA = '01JBBBBBBBBBBBBBBBBBBBBBB3'
const ACCT_DARLING_SMBC = '01JBBBBBBBBBBBBBBBBBBBBBB4'
const ACCT_DARLING_CARD = '01JBBBBBBBBBBBBBBBBBBBBBB5'
const ACCT_DARLING_NISA = '01JBBBBBBBBBBBBBBBBBBBBBB6'

const UNPAID_HONEY = '01JCCCCCCCCCCCCCCCCCCCCCC1'
const UNPAID_DARLING = '01JCCCCCCCCCCCCCCCCCCCCCC2'

const BASELINE = new Date('2026-06-01T00:00:00.000Z')
const REGISTERED = new Date('2026-05-01T00:00:00.000Z')

function makeAppUserPayload(userId: string, role: 'honey' | 'darling') {
  return serializeForPayload({
    kind: 'operation_started',
    common: {
      userId,
      role,
      firstRegisteredAt: REGISTERED,
    },
    phase2CompletedAt: REGISTERED,
    gmailTokenRef: {
      userId,
      tokenStoreRef: `/warimaru/dev/${role}/gmail-token`,
    },
    initialBalanceRef: {
      smbcAccountId: role === 'honey' ? ACCT_HONEY_SMBC : ACCT_DARLING_SMBC,
      otherSavingsAccountId: role === 'honey' ? ACCT_HONEY_SMBC : ACCT_DARLING_SMBC,
      nisaAccountId: role === 'honey' ? ACCT_HONEY_NISA : ACCT_DARLING_NISA,
    },
    operationStartedAt: REGISTERED,
    lineOperationSettings: {
      friendAdd: { kind: 'added', followWebhookReceivedAt: REGISTERED },
      // 共通トークルーム参加は世帯にひとつの事実（OQ-55 ①）。shared_talk_rooms へ別途シードする
      notificationActivation: {
        kind: 'activated',
        talkRoomId: TALK_ROOM_ID,
        activatedAt: REGISTERED,
      },
    },
  })
}

function makeSmbcPayload(accountId: string, userId: string, currentBalance: number) {
  return serializeForPayload({
    kind: 'smbc_bank',
    common: {
      accountId,
      ownerUserId: userId,
      registeredAt: REGISTERED,
      activeness: { kind: 'active' },
    },
    balance: {
      currentBalance,
      initialBalance: currentBalance,
      initialBalanceBaselineAt: BASELINE,
      lastUpdatedAt: NOW,
    },
  })
}

function makeCardPayload(accountId: string, userId: string, unpaidId: string) {
  return serializeForPayload({
    kind: 'mitsui_sumitomo_card',
    common: {
      accountId,
      ownerUserId: userId,
      registeredAt: REGISTERED,
      activeness: { kind: 'active' },
    },
    unpaidAggregateRef: unpaidId,
  })
}

function makeNisaPayload(accountId: string, userId: string, accumulated: number) {
  return serializeForPayload({
    kind: 'nisa',
    common: {
      accountId,
      ownerUserId: userId,
      registeredAt: REGISTERED,
      activeness: { kind: 'active' },
    },
    brokerageName: { kind: 'sbi' },
    contribution: {
      currentAccumulated: accumulated,
      initialAccumulated: accumulated,
      initialAccumulatedBaselineAt: BASELINE,
      lastUpdatedAt: NOW,
    },
  })
}

function makeCategoryPayload(categoryId: string, name: string, defaultKind: string) {
  return serializeForPayload({
    kind: 'default',
    categoryId,
    name,
    scope: { kind: 'household_shared' },
    defaultKind,
  })
}

interface TxSeed {
  transactionId: string
  ownerUserId: string
  merchantName: string
  amount: number
  occurredAt: Date
  categoryId: string
  expenseClass: string
}

function makeTransactionPayload(tx: TxSeed) {
  return serializeForPayload({
    kind: 'classified',
    common: {
      transactionId: tx.transactionId,
      ownerUserId: tx.ownerUserId,
      merchantName: tx.merchantName,
      amount: tx.amount,
      occurredAt: tx.occurredAt,
      importSource: {
        kind: 'manual',
        enteredAt: NOW,
        enteredByUserId: tx.ownerUserId,
      },
    },
    details: {
      categoryId: tx.categoryId,
      expenseClass: tx.expenseClass,
      expenseTypeRef: { kind: 'non_business' },
      basis: {
        kind: 'user_manual',
        modifiedByUserId: tx.ownerUserId,
        modifiedAt: NOW,
      },
    },
  })
}

// 2026年7月 (JST) = UTC 2026-06-30T15:00:00 ~ 2026-07-31T14:59:59.999
function jstDate(day: number, hour: number): Date {
  return new Date(
    `2026-07-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00+09:00`,
  )
}

const txSeeds: TxSeed[] = [
  // 住居光熱通信 (household)
  {
    transactionId: '01JDD0000000000000000TX001',
    ownerUserId: HONEY_ID,
    merchantName: '家賃振込',
    amount: 65000,
    occurredAt: jstDate(1, 10),
    categoryId: CAT_HOUSING,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX002',
    ownerUserId: HONEY_ID,
    merchantName: '東京電力',
    amount: 8500,
    occurredAt: jstDate(5, 14),
    categoryId: CAT_HOUSING,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX003',
    ownerUserId: HONEY_ID,
    merchantName: '東京ガス',
    amount: 4200,
    occurredAt: jstDate(5, 15),
    categoryId: CAT_HOUSING,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX004',
    ownerUserId: DARLING_ID,
    merchantName: 'NTTドコモ',
    amount: 4800,
    occurredAt: jstDate(3, 11),
    categoryId: CAT_HOUSING,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX005',
    ownerUserId: DARLING_ID,
    merchantName: 'BIGLOBE光',
    amount: 2500,
    occurredAt: jstDate(3, 12),
    categoryId: CAT_HOUSING,
    expenseClass: 'household',
  },

  // 食費 (household & personal mixed)
  {
    transactionId: '01JDD0000000000000000TX006',
    ownerUserId: HONEY_ID,
    merchantName: 'イオン',
    amount: 5200,
    occurredAt: jstDate(2, 18),
    categoryId: CAT_FOOD,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX007',
    ownerUserId: HONEY_ID,
    merchantName: 'セブンイレブン',
    amount: 1200,
    occurredAt: jstDate(4, 12),
    categoryId: CAT_FOOD,
    expenseClass: 'personal_honey',
  },
  {
    transactionId: '01JDD0000000000000000TX008',
    ownerUserId: DARLING_ID,
    merchantName: 'コストコ',
    amount: 12800,
    occurredAt: jstDate(6, 14),
    categoryId: CAT_FOOD,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX009',
    ownerUserId: HONEY_ID,
    merchantName: 'まいばすけっと',
    amount: 980,
    occurredAt: jstDate(7, 19),
    categoryId: CAT_FOOD,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX010',
    ownerUserId: DARLING_ID,
    merchantName: 'スターバックス',
    amount: 580,
    occurredAt: jstDate(8, 10),
    categoryId: CAT_FOOD,
    expenseClass: 'personal_darling',
  },
  {
    transactionId: '01JDD0000000000000000TX011',
    ownerUserId: HONEY_ID,
    merchantName: 'ライフ',
    amount: 3400,
    occurredAt: jstDate(9, 17),
    categoryId: CAT_FOOD,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX012',
    ownerUserId: DARLING_ID,
    merchantName: 'サイゼリヤ',
    amount: 2200,
    occurredAt: jstDate(10, 12),
    categoryId: CAT_FOOD,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX013',
    ownerUserId: HONEY_ID,
    merchantName: 'ファミリーマート',
    amount: 650,
    occurredAt: jstDate(10, 8),
    categoryId: CAT_FOOD,
    expenseClass: 'personal_honey',
  },
  {
    transactionId: '01JDD0000000000000000TX014',
    ownerUserId: DARLING_ID,
    merchantName: 'マルエツ',
    amount: 4800,
    occurredAt: jstDate(11, 16),
    categoryId: CAT_FOOD,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX015',
    ownerUserId: HONEY_ID,
    merchantName: '松屋',
    amount: 890,
    occurredAt: jstDate(12, 13),
    categoryId: CAT_FOOD,
    expenseClass: 'personal_honey',
  },
  {
    transactionId: '01JDD0000000000000000TX016',
    ownerUserId: DARLING_ID,
    merchantName: 'ドトールコーヒー',
    amount: 420,
    occurredAt: jstDate(13, 9),
    categoryId: CAT_FOOD,
    expenseClass: 'personal_darling',
  },
  {
    transactionId: '01JDD0000000000000000TX017',
    ownerUserId: HONEY_ID,
    merchantName: 'ヨークベニマル',
    amount: 6200,
    occurredAt: jstDate(14, 11),
    categoryId: CAT_FOOD,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX018',
    ownerUserId: DARLING_ID,
    merchantName: 'カルディ',
    amount: 2680,
    occurredAt: jstDate(14, 15),
    categoryId: CAT_FOOD,
    expenseClass: 'household',
  },

  // 娯楽 (mixed)
  {
    transactionId: '01JDD0000000000000000TX019',
    ownerUserId: HONEY_ID,
    merchantName: 'Netflix',
    amount: 1490,
    occurredAt: jstDate(1, 9),
    categoryId: CAT_ENTERTAINMENT,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX020',
    ownerUserId: DARLING_ID,
    merchantName: 'TOHOシネマズ',
    amount: 3600,
    occurredAt: jstDate(7, 14),
    categoryId: CAT_ENTERTAINMENT,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX021',
    ownerUserId: HONEY_ID,
    merchantName: 'Steam',
    amount: 4980,
    occurredAt: jstDate(10, 22),
    categoryId: CAT_ENTERTAINMENT,
    expenseClass: 'personal_honey',
  },
  {
    transactionId: '01JDD0000000000000000TX022',
    ownerUserId: DARLING_ID,
    merchantName: 'Amazon Kindle',
    amount: 1430,
    occurredAt: jstDate(12, 20),
    categoryId: CAT_ENTERTAINMENT,
    expenseClass: 'personal_darling',
  },

  // その他 (mixed)
  {
    transactionId: '01JDD0000000000000000TX023',
    ownerUserId: HONEY_ID,
    merchantName: 'ダイソー',
    amount: 1100,
    occurredAt: jstDate(2, 15),
    categoryId: CAT_OTHER,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX024',
    ownerUserId: DARLING_ID,
    merchantName: 'マツモトキヨシ',
    amount: 3200,
    occurredAt: jstDate(4, 13),
    categoryId: CAT_OTHER,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX025',
    ownerUserId: HONEY_ID,
    merchantName: '東京メトロ',
    amount: 2400,
    occurredAt: jstDate(6, 8),
    categoryId: CAT_OTHER,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX026',
    ownerUserId: DARLING_ID,
    merchantName: 'クリーニング屋',
    amount: 1800,
    occurredAt: jstDate(8, 16),
    categoryId: CAT_OTHER,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX027',
    ownerUserId: HONEY_ID,
    merchantName: 'ニトリ',
    amount: 5500,
    occurredAt: jstDate(9, 11),
    categoryId: CAT_OTHER,
    expenseClass: 'household',
  },
  {
    transactionId: '01JDD0000000000000000TX028',
    ownerUserId: DARLING_ID,
    merchantName: '美容室HAIR',
    amount: 4500,
    occurredAt: jstDate(11, 14),
    categoryId: CAT_OTHER,
    expenseClass: 'personal_darling',
  },
  {
    transactionId: '01JDD0000000000000000TX029',
    ownerUserId: HONEY_ID,
    merchantName: 'ユニクロ',
    amount: 500,
    occurredAt: jstDate(13, 10),
    categoryId: CAT_OTHER,
    expenseClass: 'personal_honey',
  },
]

const honeyTxs = txSeeds.filter(t => t.ownerUserId === HONEY_ID)
const darlingTxs = txSeeds.filter(t => t.ownerUserId === DARLING_ID)
const honeyCardTotal = honeyTxs.reduce((sum, t) => sum + t.amount, 0)
const darlingCardTotal = darlingTxs.reduce((sum, t) => sum + t.amount, 0)

function makeUnpaidPayload(unpaidId: string, accountId: string, total: number, txs: TxSeed[]) {
  let entryCounter = 0
  const entries = txs.map(tx => {
    entryCounter++
    return {
      kind: 'booked' as const,
      entryId: `${unpaidId.slice(0, 20)}E${String(entryCounter).padStart(5, '0')}`,
      transactionId: tx.transactionId,
      bookedAt: tx.occurredAt,
      amount: tx.amount,
    }
  })
  return serializeForPayload({
    unpaidAggregateId: unpaidId,
    accountId,
    currentMonthUnpaidTotal: total,
    entries,
    lastSettledAt: null,
  })
}

async function seed() {
  console.log('Seeding app_users...')
  for (const u of [
    {
      userId: HONEY_ID,
      role: 'honey' as const,
      kind: 'operation_started' as const,
      payload: makeAppUserPayload(HONEY_ID, 'honey'),
    },
    {
      userId: DARLING_ID,
      role: 'darling' as const,
      kind: 'operation_started' as const,
      payload: makeAppUserPayload(DARLING_ID, 'darling'),
    },
  ]) {
    await db
      .insert(schema.appUsers)
      .values(u)
      .onConflictDoUpdate({
        target: schema.appUsers.userId,
        set: { role: u.role, kind: u.kind, payload: u.payload, updatedAt: NOW },
      })
  }

  // 共通トークルーム（世帯レベル・シングルトン）。通知配信が参照する「正」（OQ-55 ①）
  console.log('Seeding shared_talk_rooms...')
  await db
    .insert(schema.sharedTalkRooms)
    .values({ talkRoomId: TALK_ROOM_ID, joinWebhookReceivedAt: REGISTERED })
    .onConflictDoUpdate({
      target: schema.sharedTalkRooms.singleton,
      set: { talkRoomId: TALK_ROOM_ID, joinWebhookReceivedAt: REGISTERED, updatedAt: NOW },
    })

  console.log('Seeding category_masters...')
  const categories = [
    { id: CAT_HOUSING, name: '住居光熱通信', defaultKind: 'housing_utilities_communication' },
    { id: CAT_FOOD, name: '食費', defaultKind: 'food' },
    { id: CAT_ENTERTAINMENT, name: '娯楽', defaultKind: 'entertainment' },
    { id: CAT_OTHER, name: 'その他', defaultKind: 'other' },
  ] as const
  for (const c of categories) {
    const row = {
      categoryId: c.id,
      kind: 'default' as const,
      name: c.name,
      ownerUserId: null,
      payload: makeCategoryPayload(c.id, c.name, c.defaultKind),
    }
    await db
      .insert(schema.categoryMasters)
      .values(row)
      .onConflictDoUpdate({
        target: schema.categoryMasters.categoryId,
        set: { name: row.name, payload: row.payload, updatedAt: NOW },
      })
  }

  console.log('Seeding accounts...')
  const accountRows = [
    {
      accountId: ACCT_HONEY_SMBC,
      ownerUserId: HONEY_ID,
      kind: 'smbc_bank' as const,
      isActive: true,
      payload: makeSmbcPayload(ACCT_HONEY_SMBC, HONEY_ID, 1350000),
    },
    {
      accountId: ACCT_HONEY_CARD,
      ownerUserId: HONEY_ID,
      kind: 'mitsui_sumitomo_card' as const,
      isActive: true,
      payload: makeCardPayload(ACCT_HONEY_CARD, HONEY_ID, UNPAID_HONEY),
    },
    {
      accountId: ACCT_HONEY_NISA,
      ownerUserId: HONEY_ID,
      kind: 'nisa' as const,
      isActive: true,
      payload: makeNisaPayload(ACCT_HONEY_NISA, HONEY_ID, 200000),
    },
    {
      accountId: ACCT_DARLING_SMBC,
      ownerUserId: DARLING_ID,
      kind: 'smbc_bank' as const,
      isActive: true,
      payload: makeSmbcPayload(ACCT_DARLING_SMBC, DARLING_ID, 1100000),
    },
    {
      accountId: ACCT_DARLING_CARD,
      ownerUserId: DARLING_ID,
      kind: 'mitsui_sumitomo_card' as const,
      isActive: true,
      payload: makeCardPayload(ACCT_DARLING_CARD, DARLING_ID, UNPAID_DARLING),
    },
    {
      accountId: ACCT_DARLING_NISA,
      ownerUserId: DARLING_ID,
      kind: 'nisa' as const,
      isActive: true,
      payload: makeNisaPayload(ACCT_DARLING_NISA, DARLING_ID, 160000),
    },
  ]
  for (const a of accountRows) {
    await db
      .insert(schema.accounts)
      .values(a)
      .onConflictDoUpdate({
        target: schema.accounts.accountId,
        set: { kind: a.kind, isActive: a.isActive, payload: a.payload, updatedAt: NOW },
      })
  }

  console.log('Seeding mitsui_sumitomo_unpaids...')
  for (const u of [
    {
      unpaidAggregateId: UNPAID_HONEY,
      accountId: ACCT_HONEY_CARD,
      currentMonthUnpaidTotal: honeyCardTotal,
      payload: makeUnpaidPayload(UNPAID_HONEY, ACCT_HONEY_CARD, honeyCardTotal, honeyTxs),
    },
    {
      unpaidAggregateId: UNPAID_DARLING,
      accountId: ACCT_DARLING_CARD,
      currentMonthUnpaidTotal: darlingCardTotal,
      payload: makeUnpaidPayload(UNPAID_DARLING, ACCT_DARLING_CARD, darlingCardTotal, darlingTxs),
    },
  ]) {
    await db
      .insert(schema.mitsuiSumitomoUnpaids)
      .values(u)
      .onConflictDoUpdate({
        target: schema.mitsuiSumitomoUnpaids.unpaidAggregateId,
        set: {
          currentMonthUnpaidTotal: u.currentMonthUnpaidTotal,
          payload: u.payload,
          updatedAt: NOW,
        },
      })
  }

  console.log('Seeding transactions...')
  for (const tx of txSeeds) {
    const row = {
      transactionId: tx.transactionId,
      ownerUserId: tx.ownerUserId,
      kind: 'classified' as const,
      merchantName: tx.merchantName,
      amount: tx.amount,
      occurredAt: tx.occurredAt,
      categoryId: tx.categoryId,
      expenseClass: tx.expenseClass,
      payload: makeTransactionPayload(tx),
    }
    await db
      .insert(schema.transactions)
      .values(row)
      .onConflictDoUpdate({
        target: schema.transactions.transactionId,
        set: {
          kind: row.kind,
          merchantName: row.merchantName,
          amount: row.amount,
          occurredAt: row.occurredAt,
          categoryId: row.categoryId,
          expenseClass: row.expenseClass,
          payload: row.payload,
          updatedAt: NOW,
        },
      })
  }

  console.log('Seed complete!')
}

// node-postgres はプールを保持するため、閉じないとスクリプトが終了しない
seed()
  .catch(err => {
    console.error('Seed failed:', err)
    process.exitCode = 1
  })
  .finally(() =>
    // close の失敗で seed 本体の失敗理由が unhandled rejection に埋もれないようにする
    connection.close().catch(e => console.error('Failed to close DB connection:', e)),
  )
