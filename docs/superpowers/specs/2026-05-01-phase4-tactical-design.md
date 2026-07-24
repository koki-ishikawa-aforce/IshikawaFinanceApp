# Phase 4 戦術的設計 spec — Core 2 コンテキスト先行

> 作成: 2026-05-01
> ブレストセッション: 本ファイル直前の対話（superpowers:brainstorming, /home/koki/IshikawaFinanceApp）
> 親 spec / 直接の前提:
> - [Phase 3 戦略的設計 spec](./2026-05-01-phase3-approach-design.md)
> - [Phase 3.5 UX/UI 設計 spec](./2026-05-01-phase3.5-ux-ui-design.md)
> - [Phase 4 引き継ぎサマリ](../plans/2026-05-01-phase4-handoff.md)
> 関連 DDD docs: [07-bounded-contexts.md](../../domain/07-bounded-contexts.md), [08c-ul-家計分析.md](../../domain/08c-ul-家計分析.md), [08d-ul-残高資産推移管理.md](../../domain/08d-ul-残高資産推移管理.md), [09-aggregates.md](../../domain/09-aggregates.md)

---

## §1. 目的とスコープ

### §1.1 目的

Phase 3 で確定した 8 コンテキスト・21 集約のうち、**Core サブドメインに該当する 4 コンテキストの中から「家計分析」「残高・資産推移管理」の 2 つを先行**して TypeScript 型 + Zod スキーマ + リポジトリ I/F として実装可能な形に翻訳する。

Phase 3.5 の UI 要求（KPI 4 枚 / カテゴリドーナツ / 月次レポート / 残高推移）から逆算したデータ契約をこの 2 コンテキストに集中させ、**画面 → Query → 集約**の縦串を最初に通すことで Phase 5 以降の実装基盤を築く。

### §1.2 スコープ

**In scope（Phase 4 で型化する集約）**:
- 家計分析: 取引（#7）, 月次レポート（#8）
- 残高・資産推移管理: 口座（#9）, 三井住友カード未払金集約（#10）

**Out of scope（Phase 5 以降）**:
- 残り 6 コンテキスト（取引取込 / 自動分類・学習 / 経費精算 / オンボーディング・認証 / 通知配信 / マスタ管理）の型化
- adapter 層の実装（DynamoDB / RDS との接続）
- LIFF アプリ（packages/web）の作成
- Lambda handlers（packages/api）の作成
- 状態管理ライブラリ（TanStack Query 等）の導入
- ドメインイベントの実配信（Phase 4 では型定義のみ）

### §1.3 達成状態

Phase 4 完了時点で以下が成立している:

1. `packages/domain/` がビルド成功し、`pnpm test` が green
2. 家計分析と残高・資産推移管理の集約 2+2 = 4 個が TS 型 + Zod スキーマで表現されている
3. Read 用 Query I/F と View 型が画面要求 1 対 1 で揃っている
4. プライバシーフィルタが Read Model 層に実装され、組み合わせテストが通る
5. Repository / Query の I/F は型のみ定義（実装は Phase 5 以降）
6. Phase 5 で adapter 層と LIFF/Lambda を追加する際の依存先（`@household/domain`）が利用可能になっている

---

## §2. 設計方針（5 つの起点質問の確定回答）

### §2.1 記述粒度: TS 慣用句 + 英語命名 + JSDoc 日本語併記

- 型は **discriminated union + branded ID + Zod refine** で TS の型システムを活用する
- 命名は英語（`Transaction`, `MonthlyReport`, `Account` 等）
- JSDoc に kawasima ミニ言語の日本語ドメイン用語を併記し、`@see docs/domain/08c-ul-家計分析.md` で参照リンクを貼る
- ファイル冒頭に対応する DDD docs ファイルへのリンクを必ず置く

### §2.2 リポジトリ I/F: CQRS 軽量分離（Repository + Query）

- **Repository（Write 側）**: 集約のライフサイクル（取得・保存・削除）に専念。`findById` は集約の完全な状態を返す
- **Query（Read 側）**: 画面要求から逆算した Read Model クエリ。プライバシー 3 段階を適用した View 型を返す
- 両者は別 interface として定義され、実装は Phase 5 以降の adapter 層で同一の永続化バックエンドに対して提供される

### §2.3 プライバシー実装位置: Read Model 層（Query）

- Repository は集約の「事実」を保持し、viewer 文脈を持たない
- Query は `viewerId` 引数を受け取り、Query 内部で `privacy/applyPrivacyFilter.ts` ヘルパを呼んで 3 段階ルールを適用
- 同じ取引データを「世帯モード」「個人モード」で違う View にする要求は、Query が `mode` 引数で切り替えて実現

### §2.4 ファイル構成: pnpm workspace モノレポ

- `packages/domain/` を Phase 4 で本体作成
- `packages/web/` `packages/api/` `packages/adapters-*/` は Phase 5 以降で追加（Phase 4 では空または存在しない）
- pnpm workspace + TypeScript project references でビルドを並列化

### §2.5 Zod の使い方: スキーマ主体、TS 型は z.infer で派生

- Zod スキーマを正本として書き、TS 型は `z.infer<typeof XxxSchema>` で派生
- 二重定義を避け、ランタイム検証と型安全を一致させる
- 不変条件は `z.refine` または `superRefine` で表現
- branded ID は `z.string().brand<'TransactionId'>()` パターン

---

## §3. モノレポ構造（確定）

### §3.1 トップレベル構成（Phase 4 時点）

```
IshikawaFinanceApp/
├─ packages/
│   └─ domain/                           # Phase 4 で本体作成
│       ├─ src/
│       │   ├─ shared/
│       │   ├─ household-analysis/
│       │   ├─ balance-asset-tracking/
│       │   └─ index.ts
│       ├─ tests/
│       ├─ package.json
│       ├─ tsconfig.json
│       └─ vitest.config.ts
├─ docs/                                 # 既存
├─ pnpm-workspace.yaml                   # 新規
├─ package.json                          # ルート
├─ tsconfig.base.json                    # 共有 TypeScript 設定
└─ .gitignore
```

### §3.2 packages/domain/src/ の階層

```
src/
├─ shared/
│   ├─ ids.ts                            # branded ID 型一式
│   ├─ value-objects/
│   │   ├─ Money.ts
│   │   ├─ YearMonth.ts
│   │   ├─ ExpenseClass.ts               # 費用区分 enum
│   │   └─ index.ts
│   ├─ events/
│   │   └─ DomainEvent.ts                # ドメインイベント基底
│   ├─ errors/
│   │   ├─ DomainError.ts                # エラー基底
│   │   └─ index.ts
│   └─ index.ts
├─ household-analysis/
│   ├─ aggregates/
│   │   ├─ Transaction.ts                # 集約: 取引
│   │   └─ MonthlyReport.ts              # 集約: 月次レポート
│   ├─ value-objects/
│   │   ├─ ClassificationBasis.ts        # 分類根拠
│   │   ├─ ImportSource.ts               # 取込ソース
│   │   ├─ TransactionStatus.ts          # 未分類/分類済み/削除済み
│   │   └─ index.ts
│   ├─ repositories/
│   │   ├─ TransactionRepository.ts      # I/F のみ
│   │   ├─ MonthlyReportRepository.ts    # I/F のみ
│   │   └─ index.ts
│   ├─ queries/
│   │   ├─ DashboardQuery.ts             # I/F + View 型
│   │   ├─ MonthlyReportQuery.ts
│   │   ├─ TransactionListQuery.ts
│   │   ├─ views/
│   │   │   ├─ DashboardKpisView.ts
│   │   │   ├─ CategoryBreakdownView.ts
│   │   │   ├─ MonthlyReportView.ts
│   │   │   └─ TransactionListItem.ts
│   │   └─ index.ts
│   ├─ privacy/
│   │   ├─ applyPrivacyFilter.ts         # 3 段階ルール適用ヘルパ
│   │   ├─ ViewerContext.ts              # 閲覧者情報
│   │   └─ index.ts
│   ├─ events/
│   │   ├─ MonthlyReportCsvConfirmed.ts
│   │   ├─ MonthlyReportFinalized.ts
│   │   ├─ TransactionDeleted.ts
│   │   └─ index.ts
│   └─ index.ts                          # 公開 API（barrel export）
└─ balance-asset-tracking/
    ├─ aggregates/
    │   ├─ Account.ts                    # 集約: 口座（4 種の OR）
    │   └─ MitsuiSumitomoUnpaid.ts       # 集約: 三井住友カード未払金
    ├─ value-objects/
    │   ├─ AccountType.ts                # SMBC / 三井住友カード / 別銀行貯蓄 / NISA
    │   ├─ BankName.ts                   # 銀行名（Phase 3.5 追加）
    │   ├─ BrokerageName.ts              # 証券会社名（Phase 3.5 追加）
    │   ├─ BalanceFreshness.ts           # 残高鮮度根拠
    │   └─ index.ts
    ├─ repositories/
    │   ├─ AccountRepository.ts
    │   ├─ MitsuiSumitomoUnpaidRepository.ts
    │   └─ index.ts
    ├─ queries/
    │   ├─ AccountBalanceQuery.ts
    │   ├─ BalanceTimeSeriesQuery.ts
    │   ├─ views/
    │   │   ├─ AccountBalanceListView.ts
    │   │   ├─ BalanceTimeSeriesView.ts
    │   │   └─ AssetTotalView.ts
    │   └─ index.ts
    ├─ events/
    │   ├─ AccountBalanceUpdated.ts
    │   ├─ UnpaidBookkept.ts
    │   ├─ UnpaidSettled.ts
    │   ├─ NisaContributionAdded.ts
    │   └─ index.ts
    └─ index.ts                          # 公開 API
```

### §3.3 公開 API（barrel export）

各コンテキストの `index.ts` から公開する型は以下:

```ts
// packages/domain/src/household-analysis/index.ts
export * from './aggregates'
export * from './repositories'
export * from './queries'
export * from './events'
export type { ViewerContext } from './privacy'
// privacy/applyPrivacyFilter は内部実装のため非公開
```

`packages/domain/src/index.ts` から各コンテキストの barrel を再 export し、利用側は:

```ts
import {
  Transaction,
  TransactionRepository,
  DashboardQuery,
  type DashboardKpisView,
} from '@household/domain'
```

の形でインポートできる。

### §3.4 pnpm workspace 設定

**`pnpm-workspace.yaml`**:
```yaml
packages:
  - 'packages/*'
```

**ルート `package.json`**:
```json
{
  "name": "ishikawa-finance-app",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

**`packages/domain/package.json`**:
```json
{
  "name": "@household/domain",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -b",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

---

## §4. 共有レイヤ（packages/domain/src/shared/）

### §4.1 branded ID 型（ids.ts）

Zod の `z.brand()` を使用してコンパイル時の型安全と実行時検証を両立させる。

```ts
import { z } from 'zod'

// ULID または UUID を想定（永続化バックエンドの選択は Phase 5）
const idSchema = z.string().min(1)

export const TransactionIdSchema = idSchema.brand<'TransactionId'>()
export type TransactionId = z.infer<typeof TransactionIdSchema>

export const UserIdSchema = idSchema.brand<'UserId'>()        // LINE userID
export type UserId = z.infer<typeof UserIdSchema>

export const CategoryIdSchema = idSchema.brand<'CategoryId'>()
export type CategoryId = z.infer<typeof CategoryIdSchema>

export const ExpenseTypeIdSchema = idSchema.brand<'ExpenseTypeId'>()
export type ExpenseTypeId = z.infer<typeof ExpenseTypeIdSchema>

export const AccountIdSchema = idSchema.brand<'AccountId'>()
export type AccountId = z.infer<typeof AccountIdSchema>

export const MitsuiSumitomoUnpaidIdSchema = idSchema.brand<'MitsuiSumitomoUnpaidId'>()
export type MitsuiSumitomoUnpaidId = z.infer<typeof MitsuiSumitomoUnpaidIdSchema>

export const UnpaidEntryIdSchema = idSchema.brand<'UnpaidEntryId'>()
export type UnpaidEntryId = z.infer<typeof UnpaidEntryIdSchema>

export const MonthlyReportIdSchema = idSchema.brand<'MonthlyReportId'>()
export type MonthlyReportId = z.infer<typeof MonthlyReportIdSchema>

export const ExpenseReimbursementIdSchema = idSchema.brand<'ExpenseReimbursementId'>()
export type ExpenseReimbursementId = z.infer<typeof ExpenseReimbursementIdSchema>

// メール由来 ID（取引取込から借用予定）
export const GmailMessageIdSchema = idSchema.brand<'GmailMessageId'>()
export type GmailMessageId = z.infer<typeof GmailMessageIdSchema>
```

利用例:
```ts
const tx: TransactionId = TransactionIdSchema.parse('01HXYZ...')
const acc: AccountId = AccountIdSchema.parse('01ABCD...')
// 以下はコンパイルエラー: branded type の混同を防げる
// someFunction(tx)  // someFunction が AccountId を要求していたら型エラー
```

### §4.2 値オブジェクト

#### Money.ts（金額）

kawasima `data 金額 = 整数` に対応。日本円の最小単位（円）を整数で保持。

```ts
import { z } from 'zod'

export const MoneySchema = z.number().int().finite().brand<'Money'>()
export type Money = z.infer<typeof MoneySchema>

export function money(value: number): Money {
  return MoneySchema.parse(value)
}

export function addMoney(a: Money, b: Money): Money {
  return money(a + b)
}

export function subtractMoney(a: Money, b: Money): Money {
  return money(a - b)
}
```

#### YearMonth.ts（対象年月）

```ts
import { z } from 'zod'

// "YYYY-MM" 形式
export const YearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 形式である必要があります')
  .brand<'YearMonth'>()
export type YearMonth = z.infer<typeof YearMonthSchema>

export function yearMonth(year: number, month: number): YearMonth {
  const mm = String(month).padStart(2, '0')
  return YearMonthSchema.parse(`${year}-${mm}`)
}

export function previousMonth(ym: YearMonth, count = 1): YearMonth {
  const [y, m] = ym.split('-').map(Number) as [number, number]
  let year = y
  let month = m
  for (let i = 0; i < count; i++) {
    if (month === 1) {
      year -= 1
      month = 12
    } else {
      month -= 1
    }
  }
  return yearMonth(year, month)
}
```

#### ExpenseClass.ts（費用区分）

kawasima `data 費用区分 = 世帯 OR 個人(夫) OR 個人(妻) OR 経費(会社)` に対応。

```ts
import { z } from 'zod'

export const ExpenseClassSchema = z.enum([
  'household',          // 世帯
  'personal_honey',     // 個人(夫) = Honey
  'personal_darling',   // 個人(妻) = Darling
  'business_expense',   // 経費(会社)
])
export type ExpenseClass = z.infer<typeof ExpenseClassSchema>
```

> **命名注**: Honey/Darling の対応は Phase 3.5 で確定（[2026-05-01-phase3.5-ux-ui-design.md §3](./2026-05-01-phase3.5-ux-ui-design.md)）。`personal_honey` = 夫、`personal_darling` = 妻。

> **Owner / Role 型について**: kawasima の `data 所有者 = 夫 OR 妻 OR 共有` および Phase 3.5 の `役割 = Honey OR Darling` は Phase 4 の集約（取引・月次レポート・口座・未払金）には属性として現れず、`ownerUserId: UserId` で十分表現できる。Owner / Role 型は Phase 5 でオンボーディング・認証コンテキストの型化と合わせて導入する（カテゴリマスタ・経費種別マスタの所有スコープで必要になる）。Phase 4 では型を作らない。プライバシー判定の `ViewerRole`（§5.5）のみ Honey/Darling enum を導入する。

### §4.3 ドメインイベント基底

```ts
// packages/domain/src/shared/events/DomainEvent.ts
import { z } from 'zod'

export const DomainEventBaseSchema = z.object({
  eventId: z.string().min(1),
  occurredAt: z.date(),
  // payload は派生イベント側で定義
})
export type DomainEventBase = z.infer<typeof DomainEventBaseSchema>

// 各コンテキスト・各イベントは DomainEventBase を extend して定義する
```

### §4.4 エラー型（throw 方式）

```ts
// packages/domain/src/shared/errors/DomainError.ts
export class DomainError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = this.constructor.name
  }
}

export class InvariantViolationError extends DomainError {}
export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`)
  }
}
export class PermissionDeniedError extends DomainError {}
```

ポリシー:
- Repository の `findById` は「見つからない」を `Promise<T | null>` で表現し throw しない
- 集約のメソッドが不変条件違反を起こす場合は `InvariantViolationError` を throw
- Query で権限が無いリソースへのアクセスがあれば `PermissionDeniedError` を throw（プライバシーは「見せない」が基本だが、明示的な権限エラーは別）

---

## §5. 家計分析コンテキスト（household-analysis）

### §5.1 集約: Transaction（取引）

#### kawasima 表現（08c §1 より）

```
data 取引 = 未分類取引 OR 分類済み取引 OR 削除済み取引
data 共通取引属性 = 取引ID AND 所有者ユーザーID AND 加盟店名 AND 金額 AND 発生日時 AND 取込ソース
data 分類済み取引 = 共通取引属性 AND カテゴリID AND 費用区分 AND 経費種別参照 AND 分類根拠
不変条件: 経費(会社) 取引なら経費種別 ID 必須 / 削除済み取引は変更不可
```

#### TS + Zod 翻訳

```ts
// packages/domain/src/household-analysis/aggregates/Transaction.ts
/**
 * 取引集約（家計分析コンテキスト）
 * @see docs/domain/08c-ul-家計分析.md §1
 * @see docs/domain/09-aggregates.md #7
 *
 * kawasima: data 取引 = 未分類取引 OR 分類済み取引 OR 削除済み取引
 */
import { z } from 'zod'
import {
  TransactionIdSchema,
  UserIdSchema,
  CategoryIdSchema,
  ExpenseTypeIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'
import { ImportSourceSchema } from '../value-objects/ImportSource'
import { ClassificationBasisSchema } from '../value-objects/ClassificationBasis'

/** 共通取引属性 */
export const CommonTransactionAttrsSchema = z.object({
  transactionId: TransactionIdSchema,
  ownerUserId: UserIdSchema,
  merchantName: z.string().min(1),
  amount: MoneySchema,
  occurredAt: z.date(),
  importSource: ImportSourceSchema,
})
export type CommonTransactionAttrs = z.infer<typeof CommonTransactionAttrsSchema>

/** 未分類理由 */
export const UnclassifiedReasonSchema = z.enum([
  'merchant_rule_unlearned',           // 加盟店ルール未学習
  'amazon_product_key_unlearned',      // Amazon 商品キー未学習
  'amazon_product_info_undecidable',   // Amazon 商品情報判定不能
  'amazon_match_timeout',              // Amazon 突合タイムアウト
  'learning_disabled',                 // 学習無効化適用
])
export type UnclassifiedReason = z.infer<typeof UnclassifiedReasonSchema>

/** デフォルト費用区分（未分類取引の暫定区分） */
export const DefaultExpenseClassSchema = z.enum(['personal_honey', 'personal_darling'])
export type DefaultExpenseClass = z.infer<typeof DefaultExpenseClassSchema>

/** 経費種別参照: 経費(会社)取引なら経費種別ID 必須 */
export const ExpenseTypeRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('business'), expenseTypeId: ExpenseTypeIdSchema }),
  z.object({ kind: z.literal('non_business') }),
])
export type ExpenseTypeRef = z.infer<typeof ExpenseTypeRefSchema>

/** 分類済み取引固有データ */
export const ClassifiedDetailsSchema = z.object({
  categoryId: CategoryIdSchema,
  expenseClass: ExpenseClassSchema,
  expenseTypeRef: ExpenseTypeRefSchema,
  basis: ClassificationBasisSchema,
})
export type ClassifiedDetails = z.infer<typeof ClassifiedDetailsSchema>

/** 削除理由 */
export const DeletionReasonSchema = z.enum([
  'user_deleted',         // ユーザー削除
  'merge_absorbed',       // 二重取込マージ吸収
  'refund_match_absorbed' // 返金マッチ吸収
])
export type DeletionReason = z.infer<typeof DeletionReasonSchema>

/** 取引（discriminated union） */
export const TransactionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('unclassified'),
    common: CommonTransactionAttrsSchema,
    reason: UnclassifiedReasonSchema,
    defaultExpenseClass: DefaultExpenseClassSchema,
  }),
  z.object({
    kind: z.literal('classified'),
    common: CommonTransactionAttrsSchema,
    details: ClassifiedDetailsSchema,
  }).superRefine((tx, ctx) => {
    // 不変条件: 経費(会社) なら expenseTypeRef.kind === 'business'
    if (
      tx.details.expenseClass === 'business_expense' &&
      tx.details.expenseTypeRef.kind !== 'business'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '経費(会社) 取引は expenseTypeRef.kind = business が必須',
        path: ['details', 'expenseTypeRef'],
      })
    }
    // 逆方向: 経費(会社) 以外で expenseTypeRef.kind === 'business' は不可
    if (
      tx.details.expenseClass !== 'business_expense' &&
      tx.details.expenseTypeRef.kind === 'business'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '経費(会社) 以外の取引は expenseTypeRef.kind = non_business である必要がある',
        path: ['details', 'expenseTypeRef'],
      })
    }
  }),
  z.object({
    kind: z.literal('deleted'),
    common: CommonTransactionAttrsSchema,
    deletedAt: z.date(),
    deletionReason: DeletionReasonSchema,
  }),
])
export type Transaction = z.infer<typeof TransactionSchema>

// 補助型: 各バリアント
export type UnclassifiedTransaction = Extract<Transaction, { kind: 'unclassified' }>
export type ClassifiedTransaction = Extract<Transaction, { kind: 'classified' }>
export type DeletedTransaction = Extract<Transaction, { kind: 'deleted' }>
```

#### 不変条件の実行時保証

```ts
// 取引の生成は必ずスキーマ経由で行う
export function createTransaction(input: unknown): Transaction {
  return TransactionSchema.parse(input)  // 不正データは ZodError を throw
}
```

#### 状態遷移用の純粋関数（必要最小限）

集約のライフサイクルは Phase 4 では「型遷移可能性の表現」までで、実際の振る舞い実装（behavior）は Phase 5 以降。以下は型レベルでの遷移ヘルパのみ:

```ts
export function classify(
  unclassified: UnclassifiedTransaction,
  details: ClassifiedDetails,
): ClassifiedTransaction {
  return TransactionSchema.parse({
    kind: 'classified',
    common: unclassified.common,
    details,
  }) as ClassifiedTransaction
}

export function deleteTransaction(
  tx: UnclassifiedTransaction | ClassifiedTransaction,
  reason: DeletionReason,
  at: Date,
): DeletedTransaction {
  return TransactionSchema.parse({
    kind: 'deleted',
    common: tx.common,
    deletedAt: at,
    deletionReason: reason,
  }) as DeletedTransaction
}
```

### §5.2 集約: MonthlyReport（月次レポート）

```ts
// packages/domain/src/household-analysis/aggregates/MonthlyReport.ts
/**
 * 月次レポート集約（家計分析コンテキスト）
 * @see docs/domain/08c-ul-家計分析.md §1
 * @see docs/domain/09-aggregates.md #8
 *
 * kawasima: data 月次レポート = CSV確定月次レポート OR 最終確定月次レポート
 * 不変条件: CSV確定 → 最終確定 の単方向遷移のみ許容
 */
import { z } from 'zod'
import {
  MonthlyReportIdSchema,
  TransactionIdSchema,
  ExpenseReimbursementIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { YearMonthSchema } from '../../shared/value-objects/YearMonth'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'
import { CategoryIdSchema } from '../../shared/ids'

/** 残高推移パート（残高・資産推移管理から借用する Read-only データ） */
export const BalanceTrendSchema = z.object({
  smbcBalanceTrend: z.array(z.object({ date: z.date(), balance: MoneySchema })),
  otherSavingsBalanceTrend: z.array(z.object({ date: z.date(), balance: MoneySchema })),
  nisaContributionTrend: z.array(z.object({ date: z.date(), accumulated: MoneySchema })),
  cardUnpaidTrend: z.array(z.object({ date: z.date(), unpaidTotal: MoneySchema })),
})
export type BalanceTrend = z.infer<typeof BalanceTrendSchema>

/** 月次レポート共通属性 */
export const CommonMonthlyReportAttrsSchema = z.object({
  monthlyReportId: MonthlyReportIdSchema,
  targetYearMonth: YearMonthSchema,
  householdCategoryTotals: z.array(z.object({
    categoryId: CategoryIdSchema,
    total: MoneySchema,
  })),
  personalTotalHoney: MoneySchema,
  personalTotalDarling: MoneySchema,
  businessExpenseTotalHoney: MoneySchema,
  businessExpenseTotalDarling: MoneySchema,
  nisaContributionAccumulated: MoneySchema,
  balanceTrend: BalanceTrendSchema,
  isIncompleteMonth: z.boolean().optional(),  // 運用開始月のみ true
})
export type CommonMonthlyReportAttrs = z.infer<typeof CommonMonthlyReportAttrsSchema>

/** 不認定分振替 */
export const UnapprovedExpenseTransferSchema = z.object({
  originalBusinessExpenseTransactionId: TransactionIdSchema,
  transferTarget: z.enum(['personal_honey', 'personal_darling']),
  transferAmount: MoneySchema,
  transferredAt: z.date(),
})
export type UnapprovedExpenseTransfer = z.infer<typeof UnapprovedExpenseTransferSchema>

/** 月次レポート（discriminated union） */
export const MonthlyReportSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('csv_confirmed'),
    common: CommonMonthlyReportAttrsSchema,
    csvConfirmedAt: z.date(),
    causingTransactionIds: z.array(TransactionIdSchema),
  }),
  z.object({
    kind: z.literal('finalized'),
    common: CommonMonthlyReportAttrsSchema,
    csvConfirmedAt: z.date(),
    finalizedAt: z.date(),
    expenseReimbursementId: ExpenseReimbursementIdSchema,
    expenseReimbursementMatchedAt: z.date(),
    unapprovedTransfers: z.array(UnapprovedExpenseTransferSchema),
  }),
])
export type MonthlyReport = z.infer<typeof MonthlyReportSchema>

export type CsvConfirmedReport = Extract<MonthlyReport, { kind: 'csv_confirmed' }>
export type FinalizedReport = Extract<MonthlyReport, { kind: 'finalized' }>

/** 状態遷移: CSV確定 → 最終確定（単方向） */
export function finalize(
  report: CsvConfirmedReport,
  expenseReimbursementId: ExpenseReimbursementId,
  matchedAt: Date,
  unapprovedTransfers: UnapprovedExpenseTransfer[],
  finalizedAt: Date,
): FinalizedReport {
  return MonthlyReportSchema.parse({
    kind: 'finalized',
    common: report.common,
    csvConfirmedAt: report.csvConfirmedAt,
    finalizedAt,
    expenseReimbursementId,
    expenseReimbursementMatchedAt: matchedAt,
    unapprovedTransfers,
  }) as FinalizedReport
}

// finalized → csv_confirmed への逆遷移関数は型として存在しない（不変条件で禁止）
```

### §5.3 Repository I/F

```ts
// packages/domain/src/household-analysis/repositories/TransactionRepository.ts
import type { TransactionId, UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { Transaction } from '../aggregates/Transaction'

export interface TransactionRepository {
  /** ID で取引を取得。見つからなければ null。 */
  findById(id: TransactionId): Promise<Transaction | null>

  /** 指定ユーザーの指定月の全取引を取得（プライバシー適用なし、Read 側で適用する） */
  findByMonth(ownerId: UserId, month: YearMonth): Promise<Transaction[]>

  /** 取引を保存（新規・更新両対応、状態遷移後の集約をそのまま渡す） */
  save(transaction: Transaction): Promise<void>

  /** 物理削除ではなく、kind = 'deleted' に遷移済みの集約を save() で渡す。 */
  // 物理削除メソッドは Phase 4 では提供しない
}
```

```ts
// packages/domain/src/household-analysis/repositories/MonthlyReportRepository.ts
import type { MonthlyReportId, UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { MonthlyReport } from '../aggregates/MonthlyReport'

export interface MonthlyReportRepository {
  findById(id: MonthlyReportId): Promise<MonthlyReport | null>
  findByMonth(month: YearMonth): Promise<MonthlyReport | null>  // 1 月 1 レポート
  save(report: MonthlyReport): Promise<void>
}
```

### §5.4 Query I/F + View 型

#### View 型の方針

- 集約型を `Pick`/`Omit` で必要フィールドだけ取り出すか、Zod スキーマから新規定義
- View 型は Read 専用（mutator なし）、フィールド名は集約と揃える（変換コストを最小化）
- プライバシー適用済みフィールドはオプショナル（`?`）にする — 配偶者から見えない場合は `undefined`

#### DashboardKpisView（KPI 4 枚）

```ts
// packages/domain/src/household-analysis/queries/views/DashboardKpisView.ts
/**
 * Phase 3.5 ダッシュボード KPI 4 枚に対応
 * @see docs/domain/wireframes/README.md §1（ダッシュボード）
 *
 * KPI: 当月支出 / 貯蓄残高 / NISA 積立原資 / 資産合計
 * 世帯モードと個人モードで返り値が変わる:
 *  - 世帯モード: 全 KPI 表示
 *  - 個人モード: 当月支出は本人個人合計のみ、他は同じ
 */
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const DashboardKpisViewSchema = z.object({
  mode: z.enum(['household', 'personal']),
  /** 当月支出 */
  currentMonthSpending: MoneySchema,
  /** 貯蓄残高（SMBC + 別銀行貯蓄合算）— 残高・資産推移管理から借用 */
  savingsBalance: MoneySchema,
  /** NISA 積立原資（累計）— 残高・資産推移管理から借用 */
  nisaContributionAccumulated: MoneySchema,
  /** 資産合計（貯蓄残高 + NISA 積立原資 - 三井住友カード未払金）— 残高・資産推移管理から借用 */
  totalAssets: MoneySchema,
})
export type DashboardKpisView = z.infer<typeof DashboardKpisViewSchema>
```

#### CategoryBreakdownView（ドーナツチャート）

```ts
// packages/domain/src/household-analysis/queries/views/CategoryBreakdownView.ts
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { CategoryIdSchema } from '../../../shared/ids'

export const CategoryBreakdownItemSchema = z.object({
  categoryId: CategoryIdSchema,
  categoryName: z.string(),     // マスタから join 済み（Query 内で resolve）
  total: MoneySchema,
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
})
export type CategoryBreakdownItem = z.infer<typeof CategoryBreakdownItemSchema>

export const CategoryBreakdownViewSchema = z.object({
  mode: z.enum(['household', 'personal']),
  yearMonth: z.string(),  // YearMonth
  totalAmount: MoneySchema,
  items: z.array(CategoryBreakdownItemSchema),
})
export type CategoryBreakdownView = z.infer<typeof CategoryBreakdownViewSchema>
```

#### TransactionListItem（取引一覧）

```ts
// packages/domain/src/household-analysis/queries/views/TransactionListItem.ts
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { ExpenseClassSchema } from '../../../shared/value-objects/ExpenseClass'
import { TransactionIdSchema, CategoryIdSchema } from '../../../shared/ids'

/**
 * 取引一覧の 1 行。プライバシー 3 段階適用済み:
 *  - 配偶者が見ている個人取引は merchantName / categoryName / amount を null にして金額のみ aggregated に含める
 *  - 経費(会社) 取引は本人以外には一切含まれない（リスト自体から除外される）
 */
export const TransactionListItemSchema = z.object({
  transactionId: TransactionIdSchema,
  occurredAt: z.date(),
  expenseClass: ExpenseClassSchema,
  categoryId: CategoryIdSchema.nullable(),    // 未分類なら null
  categoryName: z.string().nullable(),
  merchantName: z.string().nullable(),         // プライバシーで隠す場合 null
  amount: MoneySchema.nullable(),              // 個人(相手) なら明細を見せない場合 null
  isUnclassified: z.boolean(),
})
export type TransactionListItem = z.infer<typeof TransactionListItemSchema>
```

#### Query I/F

```ts
// packages/domain/src/household-analysis/queries/DashboardQuery.ts
import type { UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { DashboardKpisView } from './views/DashboardKpisView'
import type { CategoryBreakdownView } from './views/CategoryBreakdownView'

export type DashboardMode = 'household' | 'personal'

export interface DashboardQuery {
  /** ダッシュボード KPI 4 枚を取得（プライバシー適用済み） */
  fetchKpis(viewerId: UserId, month: YearMonth, mode: DashboardMode): Promise<DashboardKpisView>

  /** カテゴリドーナツチャート用集計（プライバシー適用済み） */
  fetchCategoryBreakdown(
    viewerId: UserId,
    month: YearMonth,
    mode: DashboardMode,
  ): Promise<CategoryBreakdownView>
}
```

```ts
// packages/domain/src/household-analysis/queries/MonthlyReportQuery.ts
import type { UserId, MonthlyReportId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { MonthlyReportView } from './views/MonthlyReportView'

export interface MonthlyReportQuery {
  fetchByMonth(viewerId: UserId, month: YearMonth): Promise<MonthlyReportView | null>
  fetchById(viewerId: UserId, id: MonthlyReportId): Promise<MonthlyReportView | null>
}
```

```ts
// packages/domain/src/household-analysis/queries/TransactionListQuery.ts
import type { UserId } from '../../shared/ids'
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { ExpenseClass } from '../../shared/value-objects/ExpenseClass'
import type { TransactionListItem } from './views/TransactionListItem'

export interface TransactionListFilter {
  month: YearMonth
  expenseClass?: ExpenseClass
  isUnclassifiedOnly?: boolean
}

export interface TransactionListQuery {
  /** 取引一覧（プライバシー適用済み） */
  fetch(viewerId: UserId, filter: TransactionListFilter): Promise<TransactionListItem[]>

  /** 未分類サマリ（ダッシュボードの「未分類: N件」ウィジェット用） */
  fetchUnclassifiedSummary(viewerId: UserId, month: YearMonth): Promise<{
    count: number
    recentIds: TransactionId[]
  }>
}
```

### §5.5 プライバシーフィルタヘルパ

```ts
// packages/domain/src/household-analysis/privacy/ViewerContext.ts
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'

export const ViewerRoleSchema = z.enum(['honey', 'darling'])
export type ViewerRole = z.infer<typeof ViewerRoleSchema>

export const ViewerContextSchema = z.object({
  viewerId: UserIdSchema,
  role: ViewerRoleSchema,
})
export type ViewerContext = z.infer<typeof ViewerContextSchema>
```

```ts
// packages/domain/src/household-analysis/privacy/applyPrivacyFilter.ts
/**
 * プライバシー 3 段階を取引リストに適用するヘルパ。
 * Query レイヤから呼ばれる唯一のプライバシー判定ポイント。
 *
 * ルール:
 *  1. 世帯（household）: 両者に明細・合計とも可視
 *  2. 個人(本人)（personal_honey/darling）: 本人には明細・合計、配偶者には合計のみ可視
 *  3. 経費(会社)（business_expense）: 本人のみ明細・合計可視、配偶者には一切不可視
 */
import type { Transaction, ClassifiedTransaction } from '../aggregates/Transaction'
import type { ViewerContext } from './ViewerContext'
import type { TransactionListItem } from '../queries/views/TransactionListItem'

/** 個別取引が viewer から「明細レベルで」見えるかを判定 */
export function isVisibleAsDetail(tx: ClassifiedTransaction, viewer: ViewerContext): boolean {
  const ec = tx.details.expenseClass
  if (ec === 'household') return true
  if (ec === 'business_expense') return tx.common.ownerUserId === viewer.viewerId
  // personal_honey / personal_darling
  return tx.common.ownerUserId === viewer.viewerId
}

/** 個別取引が viewer の「合計値に含まれる」かを判定 */
export function isVisibleAsAggregate(tx: ClassifiedTransaction, viewer: ViewerContext): boolean {
  const ec = tx.details.expenseClass
  if (ec === 'household') return true
  if (ec === 'business_expense') return tx.common.ownerUserId === viewer.viewerId
  // personal_*: 配偶者にも合計は可視
  return true
}

/** 取引一覧 View を組み立てる（プライバシー適用） */
export function toListItems(
  txs: Transaction[],
  viewer: ViewerContext,
  categoryNames: Map<string, string>,
): TransactionListItem[] {
  return txs
    .filter(tx => tx.kind !== 'deleted')
    .filter(tx => {
      // 未分類取引は所有者本人のみリスト掲載（08c F-1 個人別: 未分類取引一覧は本人のみ）
      if (tx.kind === 'unclassified') {
        return tx.common.ownerUserId === viewer.viewerId
      }
      // 経費(会社) で他人の取引はリストから除外
      if (tx.kind === 'classified' && tx.details.expenseClass === 'business_expense') {
        return tx.common.ownerUserId === viewer.viewerId
      }
      return true
    })
    .map(tx => {
      if (tx.kind === 'unclassified') {
        // ここに来るのは所有者本人のみ（上の filter で保証）
        return {
          transactionId: tx.common.transactionId,
          occurredAt: tx.common.occurredAt,
          expenseClass: tx.defaultExpenseClass,
          categoryId: null,
          categoryName: null,
          merchantName: tx.common.merchantName,
          amount: tx.common.amount,
          isUnclassified: true,
        }
      }
      // classified
      const detailVisible = isVisibleAsDetail(tx, viewer)
      return {
        transactionId: tx.common.transactionId,
        occurredAt: tx.common.occurredAt,
        expenseClass: tx.details.expenseClass,
        categoryId: tx.details.categoryId,
        categoryName: categoryNames.get(tx.details.categoryId) ?? null,
        merchantName: detailVisible ? tx.common.merchantName : null,
        amount: detailVisible ? tx.common.amount : null,
        isUnclassified: false,
      }
    })
}
```

### §5.6 ドメインイベント

```ts
// packages/domain/src/household-analysis/events/MonthlyReportCsvConfirmed.ts
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { MonthlyReportIdSchema } from '../../shared/ids'

export const MonthlyReportCsvConfirmedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyReportCsvConfirmed'),
  monthlyReportId: MonthlyReportIdSchema,
  csvConfirmedAt: z.date(),
})
export type MonthlyReportCsvConfirmed = z.infer<typeof MonthlyReportCsvConfirmedSchema>

// 同様に MonthlyReportFinalized, TransactionDeleted 等を定義
```

> **Phase 4 では型定義のみ**: イベントバス・ハンドラ登録・実配信は Phase 5 以降。

---

## §6. 残高・資産推移管理コンテキスト（balance-asset-tracking）

### §6.1 集約: Account（口座）

#### kawasima 表現（08d §1 より）

```
data 口座 = SMBC銀行口座 OR 三井住友カード OR 別銀行貯蓄口座 OR NISA口座
data 共通口座属性 = 口座ID AND 所有者ユーザーID AND 口座種別 AND 登録日時 AND アクティブ状態
data 別銀行貯蓄口座 = 共通口座属性 AND 銀行名 AND 別銀行貯蓄残高 AND 残高鮮度根拠
data NISA口座 = 共通口座属性 AND 証券会社名 AND NISA積立累計
不変条件: 同一ユーザーID + 口座種別の組合せは一意 / 銀行名・証券会社名は所有者本人のみ変更可
```

#### TS + Zod 翻訳

```ts
// packages/domain/src/balance-asset-tracking/aggregates/Account.ts
/**
 * 口座集約（残高・資産推移管理コンテキスト）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/09-aggregates.md #9
 */
import { z } from 'zod'
import {
  AccountIdSchema,
  UserIdSchema,
  MitsuiSumitomoUnpaidIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { BankNameSchema } from '../value-objects/BankName'
import { BrokerageNameSchema } from '../value-objects/BrokerageName'

/** アクティブ状態 */
export const ActivenessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('active') }),
  z.object({
    kind: z.literal('inactive'),
    inactivatedAt: z.date(),
    reason: z.string(),
  }),
])
export type Activeness = z.infer<typeof ActivenessSchema>

/** 共通口座属性 */
export const CommonAccountAttrsSchema = z.object({
  accountId: AccountIdSchema,
  ownerUserId: UserIdSchema,
  registeredAt: z.date(),
  activeness: ActivenessSchema,
})
export type CommonAccountAttrs = z.infer<typeof CommonAccountAttrsSchema>

/** SMBC 銀行残高 */
export const SmbcBalanceSchema = z.object({
  currentBalance: MoneySchema,
  initialBalance: MoneySchema,
  initialBalanceBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
})
export type SmbcBalance = z.infer<typeof SmbcBalanceSchema>

/** 別銀行貯蓄残高 */
export const OtherSavingsBalanceSchema = z.object({
  currentBalance: MoneySchema,
  initialBalance: MoneySchema,
  initialBalanceBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
})
export type OtherSavingsBalance = z.infer<typeof OtherSavingsBalanceSchema>

/** NISA 積立累計 */
export const NisaContributionSchema = z.object({
  currentAccumulated: MoneySchema,
  initialAccumulated: MoneySchema,
  initialAccumulatedBaselineAt: z.date(),
  lastUpdatedAt: z.date(),
})
export type NisaContribution = z.infer<typeof NisaContributionSchema>

/** 残高鮮度根拠（家計分析が借用する読み取り専用データ） */
export const BalanceFreshnessSourceSchema = z.object({
  lastUpdatedAt: z.date(),
})
export type BalanceFreshnessSource = z.infer<typeof BalanceFreshnessSourceSchema>

/** 口座（discriminated union） */
export const AccountSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('smbc_bank'),
    common: CommonAccountAttrsSchema,
    balance: SmbcBalanceSchema,
  }),
  z.object({
    kind: z.literal('mitsui_sumitomo_card'),
    common: CommonAccountAttrsSchema,
    /** 三井住友カード未払金集約への参照（ID のみ） */
    unpaidAggregateRef: MitsuiSumitomoUnpaidIdSchema,
  }),
  z.object({
    kind: z.literal('other_savings'),
    common: CommonAccountAttrsSchema,
    /** Phase 3.5 追加: per-user 編集可能な銀行名 */
    bankName: BankNameSchema,
    balance: OtherSavingsBalanceSchema,
    freshnessSource: BalanceFreshnessSourceSchema,
  }),
  z.object({
    kind: z.literal('nisa'),
    common: CommonAccountAttrsSchema,
    /** Phase 3.5 追加: per-user 編集可能な証券会社名 */
    brokerageName: BrokerageNameSchema,
    contribution: NisaContributionSchema,
  }),
])
export type Account = z.infer<typeof AccountSchema>

export type SmbcBankAccount = Extract<Account, { kind: 'smbc_bank' }>
export type MitsuiSumitomoCardAccount = Extract<Account, { kind: 'mitsui_sumitomo_card' }>
export type OtherSavingsAccount = Extract<Account, { kind: 'other_savings' }>
export type NisaAccount = Extract<Account, { kind: 'nisa' }>
```

#### 銀行名・証券会社名の値オブジェクト

```ts
// packages/domain/src/balance-asset-tracking/value-objects/BankName.ts
import { z } from 'zod'

/**
 * 別銀行貯蓄口座の表示用銀行名（per-user 編集可）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * 例: 「楽天銀行」「住信SBIネット銀行」
 */
export const BankNameSchema = z.string().min(1).max(50).brand<'BankName'>()
export type BankName = z.infer<typeof BankNameSchema>
```

```ts
// packages/domain/src/balance-asset-tracking/value-objects/BrokerageName.ts
import { z } from 'zod'

/**
 * NISA 口座の表示用証券会社名（per-user 編集可）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * kawasima: data 証券会社名 = SBI証券 OR 楽天証券 OR その他証券会社
 */
export const BrokerageNameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sbi') }),
  z.object({ kind: z.literal('rakuten') }),
  z.object({ kind: z.literal('other'), customName: z.string().min(1).max(50) }),
])
export type BrokerageName = z.infer<typeof BrokerageNameSchema>

/** 表示用文字列に変換 */
export function brokerageNameToDisplay(name: BrokerageName): string {
  switch (name.kind) {
    case 'sbi': return 'SBI証券'
    case 'rakuten': return '楽天証券'
    case 'other': return name.customName
  }
}
```

### §6.2 集約: MitsuiSumitomoUnpaid（三井住友カード未払金集約）

```ts
// packages/domain/src/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid.ts
/**
 * 三井住友カード未払金集約
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/09-aggregates.md #10
 *
 * 不変条件:
 *  - 当月未払金合計 = Σ 計上中エントリ金額（集約内整合）
 *  - 引落消込変動は冪等（同一引落確定通知ID で重複適用しない）
 */
import { z } from 'zod'
import {
  MitsuiSumitomoUnpaidIdSchema,
  AccountIdSchema,
  TransactionIdSchema,
  UnpaidEntryIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const UnpaidEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('booked'),
    entryId: UnpaidEntryIdSchema,
    transactionId: TransactionIdSchema,
    bookedAt: z.date(),
    amount: MoneySchema,
  }),
  z.object({
    kind: z.literal('settled'),
    entryId: UnpaidEntryIdSchema,
    transactionId: TransactionIdSchema,
    bookedAt: z.date(),
    settledAt: z.date(),
    amount: MoneySchema,
    settlementNoticeId: z.string().min(1).brand<'SettlementNoticeId'>(),
  }),
])
export type UnpaidEntry = z.infer<typeof UnpaidEntrySchema>

export const MitsuiSumitomoUnpaidSchema = z.object({
  unpaidAggregateId: MitsuiSumitomoUnpaidIdSchema,
  accountId: AccountIdSchema,
  currentMonthUnpaidTotal: MoneySchema,
  entries: z.array(UnpaidEntrySchema),
  lastSettledAt: z.date().nullable(),
}).superRefine((agg, ctx) => {
  // 不変条件: 当月未払金合計 = Σ 計上中エントリ金額
  const sumBooked = agg.entries
    .filter(e => e.kind === 'booked')
    .reduce((acc, e) => acc + e.amount, 0)
  if (sumBooked !== agg.currentMonthUnpaidTotal) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `当月未払金合計（${agg.currentMonthUnpaidTotal}）と計上中エントリ合計（${sumBooked}）が一致しない`,
      path: ['currentMonthUnpaidTotal'],
    })
  }
})
export type MitsuiSumitomoUnpaid = z.infer<typeof MitsuiSumitomoUnpaidSchema>
```

### §6.3 Repository I/F

```ts
// packages/domain/src/balance-asset-tracking/repositories/AccountRepository.ts
import type { AccountId, UserId } from '../../shared/ids'
import type { Account } from '../aggregates/Account'

export interface AccountRepository {
  findById(id: AccountId): Promise<Account | null>
  findByOwner(ownerId: UserId): Promise<Account[]>
  /**
   * 同一ユーザー × 同一口座種別の重複は事前に呼び出し側で確認すること。
   * 集約の不変条件「同一ユーザーID + 口座種別の組合せは一意」は集約境界をまたぐため、
   * Repository.save 時に最終チェックを別途行う（Phase 5 で実装方法を確定）。
   */
  save(account: Account): Promise<void>
}
```

```ts
// packages/domain/src/balance-asset-tracking/repositories/MitsuiSumitomoUnpaidRepository.ts
import type { MitsuiSumitomoUnpaidId, AccountId } from '../../shared/ids'
import type { MitsuiSumitomoUnpaid } from '../aggregates/MitsuiSumitomoUnpaid'

export interface MitsuiSumitomoUnpaidRepository {
  findById(id: MitsuiSumitomoUnpaidId): Promise<MitsuiSumitomoUnpaid | null>
  findByCardAccountId(accountId: AccountId): Promise<MitsuiSumitomoUnpaid | null>
  save(unpaid: MitsuiSumitomoUnpaid): Promise<void>
}
```

### §6.4 Query I/F + View 型

```ts
// packages/domain/src/balance-asset-tracking/queries/views/AccountBalanceListView.ts
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { AccountIdSchema } from '../../../shared/ids'

export const AccountBalanceItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('smbc_bank'),
    accountId: AccountIdSchema,
    displayName: z.literal('三井住友銀行'),
    currentBalance: MoneySchema,
    lastUpdatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('mitsui_sumitomo_card'),
    accountId: AccountIdSchema,
    displayName: z.literal('三井住友カード'),
    currentMonthUnpaidTotal: MoneySchema,
    lastSettledAt: z.date().nullable(),
  }),
  z.object({
    kind: z.literal('other_savings'),
    accountId: AccountIdSchema,
    displayName: z.string(),  // ユーザー入力銀行名
    currentBalance: MoneySchema,
    lastUpdatedAt: z.date(),
    daysSinceLastUpdate: z.number().int().nonnegative(),  // 鮮度評価用
  }),
  z.object({
    kind: z.literal('nisa'),
    accountId: AccountIdSchema,
    displayName: z.string(),  // ユーザー入力証券会社名（or 既定 'SBI証券'/'楽天証券'）
    currentAccumulated: MoneySchema,
    lastUpdatedAt: z.date(),
  }),
])
export type AccountBalanceItem = z.infer<typeof AccountBalanceItemSchema>

export const AccountBalanceListViewSchema = z.object({
  items: z.array(AccountBalanceItemSchema),
})
export type AccountBalanceListView = z.infer<typeof AccountBalanceListViewSchema>
```

```ts
// packages/domain/src/balance-asset-tracking/queries/views/BalanceTimeSeriesView.ts
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const BalancePointSchema = z.object({
  date: z.date(),
  amount: MoneySchema,
})
export type BalancePoint = z.infer<typeof BalancePointSchema>

export const BalanceTimeSeriesViewSchema = z.object({
  yearMonthRange: z.object({
    from: z.string(),  // YearMonth
    to: z.string(),
  }),
  smbc: z.array(BalancePointSchema),
  otherSavings: z.array(BalancePointSchema),
  nisaContribution: z.array(BalancePointSchema),
  cardUnpaid: z.array(BalancePointSchema),
})
export type BalanceTimeSeriesView = z.infer<typeof BalanceTimeSeriesViewSchema>
```

```ts
// packages/domain/src/balance-asset-tracking/queries/views/AssetTotalView.ts
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const AssetTotalViewSchema = z.object({
  asOf: z.date(),
  smbcBalance: MoneySchema,
  otherSavingsBalance: MoneySchema,
  nisaContributionAccumulated: MoneySchema,
  cardUnpaidTotal: MoneySchema,
  total: MoneySchema,  // smbc + otherSavings + nisa - cardUnpaid
})
export type AssetTotalView = z.infer<typeof AssetTotalViewSchema>
```

#### Query I/F

```ts
// packages/domain/src/balance-asset-tracking/queries/AccountBalanceQuery.ts
import type { UserId } from '../../shared/ids'
import type { AccountBalanceListView } from './views/AccountBalanceListView'
import type { AssetTotalView } from './views/AssetTotalView'

export interface AccountBalanceQuery {
  /**
   * 口座一覧（4 軸残高）。
   * 残高・資産推移管理にはプライバシー区分が無いため、世帯メンバー全員が同じ View を見る。
   * （プライバシーは家計分析の取引明細に対して適用される概念）
   */
  fetchBalanceList(): Promise<AccountBalanceListView>

  fetchAssetTotal(asOf: Date): Promise<AssetTotalView>
}

// packages/domain/src/balance-asset-tracking/queries/BalanceTimeSeriesQuery.ts
import type { YearMonth } from '../../shared/value-objects/YearMonth'
import type { BalanceTimeSeriesView } from './views/BalanceTimeSeriesView'

export interface BalanceTimeSeriesQuery {
  /** Phase 3.5 月次レポートの 4 軸時系列に対応 */
  fetch(from: YearMonth, to: YearMonth): Promise<BalanceTimeSeriesView>
}
```

> **プライバシー注**: 残高・資産推移管理はコンテキストレベルで「世帯共有」のため、Query に viewerId 引数は含めない。家計分析側のプライバシー（取引明細）とは別軸。

### §6.5 ドメインイベント

```ts
// packages/domain/src/balance-asset-tracking/events/AccountBalanceUpdated.ts
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const AccountBalanceUpdatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AccountBalanceUpdated'),
  accountId: AccountIdSchema,
  delta: MoneySchema,
  newBalance: MoneySchema,
})
export type AccountBalanceUpdated = z.infer<typeof AccountBalanceUpdatedSchema>

// 同様に UnpaidBookkept, UnpaidSettled, NisaContributionAdded を定義
```

---

## §7. コンテキスト間連携（家計分析 ↔ 残高・資産推移管理）

### §7.1 Customer-Supplier 関係（07-bounded-contexts §4.1）

| From | To | 関係種別 | 提供物 |
|---|---|---|---|
| 残高・資産推移管理 | 家計分析 | Customer-Supplier | 月次レポートの残高推移パートに必要なデータ / 別銀行貯蓄口座の最終更新日時（鮮度評価用） |
| 家計分析 | 残高・資産推移管理 | Customer-Supplier | 取引削除イベント（残高再計算依頼） |

### §7.2 共有 ID 型

両コンテキストで `TransactionId`, `UserId`, `AccountId` を共有する。これらは `packages/domain/src/shared/ids.ts` に定義され、両 context の集約・Query から import される。

### §7.3 残高推移パート供給の I/F

家計分析の `MonthlyReport` 集約は `BalanceTrend` を内包するが、その値の生成元は残高・資産推移管理。Phase 4 では型としては家計分析側に存在し、Phase 5 で実 adapter が `BalanceTimeSeriesQuery` を呼んで構築する想定。

```ts
// 例: Phase 5 で MonthlyReport を構築する application service の擬似コード
async function buildMonthlyReport(month: YearMonth): Promise<CsvConfirmedReport> {
  const balanceTrend = await balanceTimeSeriesQuery.fetch(previousMonth(month, 5), month)
  // ...集計と組み立て
}
```

### §7.4 鮮度評価の借用

家計分析の Query 内で「別銀行貯蓄口座が N 日以上更新がない」を判定するため、`BalanceFreshnessSource.lastUpdatedAt` を借用する。Phase 4 では型として `freshnessSource` フィールドを `Account.kind = 'other_savings'` に持たせるのみで、~~評価しきい値（鮮度アラート発火日数）は Phase 5 で確定させる（OQ-7 関連、現時点では「30 日」を仮置き）~~ → **確定済み: 35 日**（OQ-44、2026-07-24）。通知先は月次レポート画面の表示色切替のみで LINE 配信は行わない。

---

## §8. テスト戦略

### §8.1 Vitest 採用

理由:
- ESM ネイティブ（pnpm workspace + TypeScript ESM と相性が良い）
- Jest 互換 API で学習コストが低い
- TypeScript サポートがネイティブ

`packages/domain/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
    },
  },
})
```

### §8.2 集約: 不変条件のユニットテスト

例（Transaction 集約）:
```ts
// packages/domain/tests/household-analysis/aggregates/Transaction.test.ts
import { describe, it, expect } from 'vitest'
import { TransactionSchema } from '@household/domain'

describe('Transaction 不変条件', () => {
  it('経費(会社) 取引は expenseTypeRef.kind = business が必須', () => {
    expect(() => TransactionSchema.parse({
      kind: 'classified',
      common: { /* ... */ },
      details: {
        expenseClass: 'business_expense',
        expenseTypeRef: { kind: 'non_business' },  // ← NG
        // ...
      },
    })).toThrow()
  })

  it('世帯費用に経費種別が付くのは NG', () => {
    expect(() => TransactionSchema.parse({
      kind: 'classified',
      common: { /* ... */ },
      details: {
        expenseClass: 'household',
        expenseTypeRef: { kind: 'business', expenseTypeId: 'foo' },  // ← NG
        // ...
      },
    })).toThrow()
  })
})
```

例（MitsuiSumitomoUnpaid 集約）:
```ts
describe('MitsuiSumitomoUnpaid 不変条件', () => {
  it('当月未払金合計 = Σ 計上中エントリ金額', () => {
    expect(() => MitsuiSumitomoUnpaidSchema.parse({
      // ...
      currentMonthUnpaidTotal: 10000,
      entries: [
        { kind: 'booked', amount: 3000, /* ... */ },
        { kind: 'booked', amount: 5000, /* ... */ },
        // 合計 8000 だが currentMonthUnpaidTotal = 10000 → NG
      ],
    })).toThrow()
  })
})
```

### §8.3 Query: プライバシーフィルタの組み合わせテスト

#### 分類済み取引: `viewer × 所有者 × 費用区分` のマトリクス

| viewer | 所有者 | 費用区分 | リスト掲載 | 明細可視（merchantName/amount） | 合計可視 |
|---|---|---|---|---|---|
| Honey | Honey | household | ○ | ○ | ○ |
| Honey | Darling | household | ○ | ○ | ○ |
| Honey | Honey | personal_honey | ○ | ○ | ○ |
| Honey | Honey | personal_darling | ✗（所有者違い） | - | - |
| Honey | Darling | personal_darling | ○ | ✗（null） | ○（合計のみ） |
| Honey | Darling | personal_honey | ✗（ありえない組合せ） | - | - |
| Honey | Honey | business_expense | ○ | ○ | ○ |
| Honey | Darling | business_expense | ✗（リストから除外） | - | - |
| Darling | * | * | （Honey の対称） | | |

#### 未分類取引: 所有者軸のみ

| viewer | 所有者 | リスト掲載 | 明細可視 |
|---|---|---|---|
| Honey | Honey | ○ | ○（merchantName / amount とも可視） |
| Honey | Darling | ✗（08c F-1 個人別: 未分類取引一覧は本人のみ） | - |
| Darling | * | （Honey の対称） | |

#### 削除済み取引

| viewer | 所有者 | リスト掲載 |
|---|---|---|
| * | * | ✗（kind = 'deleted' は常にリストから除外） |

これらマトリクスを `applyPrivacyFilter.test.ts` で網羅する（テストケース 12+2 通り、対称性を考慮して 6+1 通り + 削除ケース 1 で省略可）。

### §8.4 Zod スキーマ: parse 成功/失敗のテスト

各値オブジェクト・集約スキーマで以下を確認:
- 正常データの `parse` 成功
- 必須フィールド欠如の `parse` 失敗
- 不正な enum 値の `parse` 失敗
- branded ID 型の混同が型エラーになる（`tsc --noEmit` で確認、ランタイムテストでは不要）

### §8.5 Phase 4 の到達目標カバレッジ

- 集約: 不変条件 100% カバー
- プライバシーフィルタ: 12 通りマトリクス 100% カバー
- 値オブジェクト: parse 成功/失敗のスモークテスト（カバレッジ目標 80%+）
- Repository / Query I/F: Phase 4 ではモックも書かない（Phase 5 で adapter 実装時に hand-in-hand でテストする）

---

## §9. TypeScript 設定

### §9.1 strict 全部 ON

`tsconfig.base.json`（ルート、各パッケージから extends）:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": false,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  }
}
```

`packages/domain/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

`packages/domain/tsconfig.test.json`（テスト用、non-composite）:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": false,
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

### §9.2 Node version

`.nvmrc`: `20`

`packages/domain/package.json` に `"engines": { "node": ">=20" }`。

---

## §10. ライブラリ選定

| ライブラリ | バージョン | 用途 | Phase 4 で導入 |
|---|---|---|---|
| `zod` | `^3.23.0` | スキーマ定義・実行時検証・型派生 | Yes |
| `vitest` | `^1.6.0` | テストランナー | Yes |
| `typescript` | `^5.4.0` | コンパイラ | Yes |
| `pnpm` | `^9.0.0` | パッケージマネージャ | Yes |
| `eslint` | `^8.57.0` | リンタ | Yes（最小設定） |
| `@typescript-eslint/parser`/`*-plugin` | `^7.0.0` | TypeScript 用 ESLint | Yes |
| `prettier` | `^3.2.0` | フォーマッタ | Yes |
| `tsx` | `^4.7.0` | スクリプト実行（必要時） | 任意 |
| `neverthrow` / `fp-ts` | - | Result 型 | **No**（採用しない、§2.5 のとおり throw 方式） |
| `react` / `liff` / `tanstack-query` | - | UI / LIFF / クエリ管理 | **No**（Phase 5 で `packages/web` に追加） |
| `aws-sdk-v3` / `dynamodb-toolbox` 等 | - | AWS 連携 | **No**（Phase 5 で `packages/adapters-*` に追加） |

### §10.1 ESLint 最小設定

`packages/domain/.eslintrc.cjs`:
```js
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: { project: './tsconfig.test.json' },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  rules: {
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-non-null-assertion': 'error',
  },
}
```

---

## §11. 命名規約

### §11.1 kawasima ↔ TS 命名対応辞書（抜粋）

完全版は Phase 5 で `docs/domain/naming-dictionary.md` として整備予定。Phase 4 で必要な範囲を以下に列挙:

| kawasima（日本語） | TS 命名 | 備考 |
|---|---|---|
| 取引 | Transaction | 集約ルート |
| 共通取引属性 | CommonTransactionAttrs | |
| 未分類取引 | UnclassifiedTransaction | discriminated union variant |
| 分類済み取引 | ClassifiedTransaction | |
| 削除済み取引 | DeletedTransaction | |
| 取引ID | TransactionId | branded type |
| 加盟店名 | merchantName | |
| 金額 | Money / amount | branded type / フィールド名 |
| 発生日時 | occurredAt | |
| 取込ソース | ImportSource | |
| カテゴリID | CategoryId | branded type |
| 経費種別ID | ExpenseTypeId | branded type |
| 費用区分 | ExpenseClass | enum |
| 経費種別参照 | ExpenseTypeRef | |
| 分類根拠 | ClassificationBasis | |
| 月次レポート | MonthlyReport | 集約ルート |
| CSV確定月次レポート | CsvConfirmedReport | variant |
| 最終確定月次レポート | FinalizedReport | variant |
| 不認定分振替 | UnapprovedExpenseTransfer | |
| 残高推移パート | BalanceTrend | |
| 口座 | Account | 集約ルート |
| SMBC銀行口座 | SmbcBankAccount | variant |
| 三井住友カード | MitsuiSumitomoCardAccount | variant |
| 別銀行貯蓄口座 | OtherSavingsAccount | variant |
| NISA口座 | NisaAccount | variant |
| 銀行名 | BankName | branded type |
| 証券会社名 | BrokerageName | discriminated union |
| 三井住友カード未払金集約 | MitsuiSumitomoUnpaid | 集約ルート |
| 計上中エントリ | UnpaidEntry kind=booked | |
| 引落消込済みエントリ | UnpaidEntry kind=settled | |
| 引落確定通知ID | SettlementNoticeId | branded type |
| プライバシースコープ | PrivacyScope | （Phase 4 では値型を導入せず、Query 内ロジックで処理）|
| 閲覧者 | ViewerContext | |
| 閲覧者役割 | ViewerRole | enum |

### §11.2 ファイル名規則

- 集約・値オブジェクト・Repository・Query interface: PascalCase（`Transaction.ts`, `AccountRepository.ts`）
- View 型: PascalCase + `View` 接尾辞（`DashboardKpisView.ts`）
- Helper 関数: camelCase（`applyPrivacyFilter.ts`）
- バレルファイル: 固定 `index.ts`
- イベント: PascalCase（`MonthlyReportCsvConfirmed.ts`）

### §11.3 JSDoc 日本語併記の基本フォーマット

```ts
/**
 * 取引集約（家計分析コンテキスト）
 * @see docs/domain/08c-ul-家計分析.md §1
 * @see docs/domain/09-aggregates.md #7
 *
 * kawasima: data 取引 = 未分類取引 OR 分類済み取引 OR 削除済み取引
 *
 * 不変条件:
 *  - 経費(会社) 取引は経費種別ID 必須
 *  - 削除済み取引は変更不可
 */
```

---

## §12. Phase 4 の DoD（Definition of Done）

以下すべてが green であること:

- [ ] D-1: ルート `pnpm install` が成功する
- [ ] D-2: `pnpm -r build` が成功する（packages/domain がビルドできる）
- [ ] D-3: `pnpm -r typecheck` が成功する（strict + noUncheckedIndexedAccess を含む）
- [ ] D-4: `pnpm -r test` が green
  - 集約 4 個（Transaction / MonthlyReport / Account / MitsuiSumitomoUnpaid）の不変条件テストが存在
  - プライバシーフィルタの 6+ パターンテストが存在
- [ ] D-5: `pnpm -r lint` がエラーゼロ
- [ ] D-6: `@household/domain` が以下を export している
  - 集約: `Transaction`, `MonthlyReport`, `Account`, `MitsuiSumitomoUnpaid` とそれぞれの Schema
  - 値オブジェクト: `Money`, `YearMonth`, `ExpenseClass`, `BankName`, `BrokerageName` とそれぞれの Schema
  - branded ID: 全 ID 型と Schema
  - Repository I/F: 4 個（Transaction / MonthlyReport / Account / MitsuiSumitomoUnpaid）
  - Query I/F: `DashboardQuery`, `MonthlyReportQuery`, `TransactionListQuery`, `AccountBalanceQuery`, `BalanceTimeSeriesQuery`
  - View 型: 各 Query が返す View 全種
  - イベント型: §5.6 / §6.5 で列挙したもの全種
  - `ViewerContext`, `ViewerRole`
- [ ] D-7: 各ファイル冒頭に対応する DDD docs へのリンクがある
- [ ] D-8: README.md（packages/domain/README.md）に「公開 API 一覧」「次フェーズへの引き継ぎ」が記載されている

---

## §13. Phase 5 以降への引き継ぎ

### §13.1 Phase 5 で取り組む範囲（想定）

1. **残り 6 コンテキストの型化**:
   - 取引取込（Supporting）/ 自動分類・学習（Core）/ 経費精算（Core）/ オンボーディング・認証（Supporting）/ 通知配信（Generic）/ マスタ管理（Supporting）
   - Phase 4 と同じパターン（discriminated union + Zod refine + Repository/Query 分離）で展開
2. **adapter 層の実装**: `packages/adapters-neon/` に Neon (PostgreSQL) 前提で実装（~~DynamoDB vs RDS を Phase 5 で選定~~ → 2026-07-06 OQ-46 で OQ-27 の確定スタックを正とした）
3. **LIFF アプリ**: `packages/web/` に Next.js (TS) Static Export + LIFF SDK で実装（~~React + Vite~~ → 同上）、TanStack Query で `@warimaru/domain` の Query I/F を消費
4. **Hono on Lambda**: `packages/api/` に Hono ベースの Lambda エントリポイント、Repository / Query の adapter 実装をワイヤリング
5. **状態管理 / フォーム**: TanStack Query / React Hook Form + Zod resolvers の導入
6. **ドメインイベントバス**: Phase 4 で型定義のみだったイベントを実配信する仕組み（in-process pub/sub or SNS/SQS）

### §13.2 Phase 4 の I/F 設計が前提とする決定事項

Phase 4 の I/F が成立するために Phase 5 で確定が必要なもの:

- ~~永続化バックエンド（DynamoDB vs RDS）~~ → **確定済み: Neon (PostgreSQL)**（OQ-27 / OQ-46、2026-07-06）。残るは DB スキーマ設計とマイグレーション方式
- ID 生成方式（ULID 推奨）— `idSchema` の正規表現を強化する余地
- ~~鮮度アラート閾値（OQ-7 関連、現状 30 日仮置き）— Query 側で参照~~ → **確定済み: 35 日 / 通知先は画面表示のみ**（OQ-44、2026-07-24）
- イベントの永続化要否 — Phase 4 では型のみで永続化責務は決めていない

---

## §14. 残課題（Open Questions）

### §14.1 既存 OQ の継続

[03-open-questions.md §B](../../domain/03-open-questions.md):
- OQ-37 アプリ名確定（Phase 4 で決定推奨、コード内のパッケージ名は `@household/domain` で進める）
- OQ-38 ✅ 三井住友銀行（SMBC ダイレクト）の月別明細 URL パターン実調査（取引取込スコープ）→ **2 段階で解決**。① 2026-07-22: 03-open-questions.md の OQ-38 は「SMBC 通知**メール**のフォーマット実調査」に読み替えられ、通知メール 3 種のフォーマットが確定（メール取込の対象はカード利用通知のみ）。② 2026-07-24（#52）: 本項が元々問うていた**明細ページの URL パターン**を実調査で確定。SP サイト `https://direct3.smbc.co.jp/sp/web/`、明細は `/sp/web/top/TPALT…` で、**月をクエリ指定する手段はない**ため月パラメータ埋込は不成立（Phase 3.5 spec §10.2 を改訂し手順表示に切替）
- OQ-39 ✅ LINE Flex Message のサイズ制限内に Honey/Darling 別リンクが収まるか検証（通知配信スコープ）→ **収まる**（2026-07-24）。4 リンク同梱の CSV取込リマインダーで 2,023 B（50KB 上限の 4.0%）
- OQ-40 テーマカラー切替の有無判断（UI 実装フェーズ、Phase 5）

### §14.2 Phase 4 で新たに発生した論点

- **OQ-41**: ID 生成方式（ULID か UUID v7 か）。Phase 5 の adapter 実装時に確定する。Phase 4 の `idSchema` は `z.string().min(1)` で受け入れているため、後から正規表現を強化できる
- **OQ-42**: ドメインイベントの永続化要否。監査・リプレイ要件があるなら永続化する設計が必要だが、家計内ツール規模では in-process pub/sub で十分の可能性
- **OQ-43**: Repository.save() 内でのトランザクション境界。集約をまたぐ更新（例: 取引修正に伴う未払金更新）はアプリケーション層で 2 集約を順次保存する設計だが、整合性は最終的に結果整合性で吸収するか、Saga パターンを導入するか
- **OQ-44** ✅: 鮮度アラート閾値（OQ-7 続）— ~~30 日仮置きを Phase 5 で実値確定~~ → **35 日で確定**（2026-07-24）。通知先は月次レポート画面の表示色切替のみ
- **OQ-45**: パッケージ名のスコープ。`@household/domain` は仮置き、OQ-37 のアプリ名確定後に renaming する可能性

---

## §15. 参考リンク

- Phase 3 spec: [2026-05-01-phase3-approach-design.md](./2026-05-01-phase3-approach-design.md)
- Phase 3.5 spec: [2026-05-01-phase3.5-ux-ui-design.md](./2026-05-01-phase3.5-ux-ui-design.md)
- Phase 4 引き継ぎサマリ: [2026-05-01-phase4-handoff.md](../plans/2026-05-01-phase4-handoff.md)
- Phase 3 plan: [2026-05-01-phase3-strategic-design.md](../plans/2026-05-01-phase3-strategic-design.md)
- Phase 3.5 plan: [2026-05-01-phase3.5-closeout.md](../plans/2026-05-01-phase3.5-closeout.md)
- 集約候補リスト: [09-aggregates.md](../../domain/09-aggregates.md)
- 境界づけられたコンテキスト: [07-bounded-contexts.md](../../domain/07-bounded-contexts.md)
- ユビキタス言語（家計分析）: [08c-ul-家計分析.md](../../domain/08c-ul-家計分析.md)
- ユビキタス言語（残高・資産推移管理）: [08d-ul-残高資産推移管理.md](../../domain/08d-ul-残高資産推移管理.md)
- 共通ユビキタス言語: [08-ubiquitous-language.md](../../domain/08-ubiquitous-language.md)
- 残課題: [03-open-questions.md](../../domain/03-open-questions.md)

---

## §16. 変更履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-05-01 | 0.1 | 初版作成（superpowers:brainstorming セッションの確定回答を反映） |
| 2026-07-06 | 0.2 | §13.1〜13.2 を OQ-27 の確定スタック（Next.js Static Export / Hono on Lambda / Neon PostgreSQL）に整合（OQ-46）。パッケージ名を `@warimaru/domain` に更新（OQ-37 アプリ名「わりまる」確定、OQ-45） |
