# @household/domain

Phase 4 戦術的設計で実装した家計分析・残高資産推移管理 2 コンテキストの TS 型 + Zod スキーマ + リポジトリ I/F + Query I/F。

> **親 spec**: [docs/superpowers/specs/2026-05-01-phase4-tactical-design.md](../../docs/superpowers/specs/2026-05-01-phase4-tactical-design.md)
> **plan**: [docs/superpowers/plans/2026-05-01-phase4-tactical-implementation.md](../../docs/superpowers/plans/2026-05-01-phase4-tactical-implementation.md)

## 公開 API（barrel: `@household/domain`）

### shared

- ID 型: `TransactionId`, `UserId`, `CategoryId`, `ExpenseTypeId`, `AccountId`, `MitsuiSumitomoUnpaidId`, `UnpaidEntryId`, `MonthlyReportId`, `ExpenseReimbursementId`, `SettlementNoticeId`, `GmailMessageId`（および各 Schema）
- 値オブジェクト: `Money`, `YearMonth`, `ExpenseClass`（および helper: `money`, `yearMonth`, `previousMonth`, `addMoney`, `subtractMoney`）
- イベント基底: `DomainEventBase`
- エラー: `DomainError`, `InvariantViolationError`, `NotFoundError`, `PermissionDeniedError`

### household-analysis（家計分析）

- 集約: `Transaction`（discriminated union: `unclassified` / `classified` / `deleted`）, `MonthlyReport`（`csv_confirmed` / `finalized`）
- 値オブジェクト: `ImportSource`, `ClassificationBasis`
- Repository I/F: `TransactionRepository`, `MonthlyReportRepository`
- Query I/F: `DashboardQuery`, `MonthlyReportQuery`, `TransactionListQuery`
- View 型: `DashboardKpisView`, `CategoryBreakdownView`, `MonthlyReportView`, `TransactionListItem`
- プライバシー: `ViewerContext`, `ViewerRole`（`applyPrivacyFilter` 関数群は内部実装、Query 実装層からのみ使用）
- ドメインイベント: `MonthlyReportCsvConfirmed`, `MonthlyReportFinalized`, `TransactionDeleted`

### balance-asset-tracking（残高・資産推移管理）

- 集約: `Account`（`smbc_bank` / `mitsui_sumitomo_card` / `other_savings` / `nisa`）, `MitsuiSumitomoUnpaid`
- 値オブジェクト: `BankName`, `BrokerageName`（および `brokerageNameToDisplay`）
- Repository I/F: `AccountRepository`, `MitsuiSumitomoUnpaidRepository`
- Query I/F: `AccountBalanceQuery`, `BalanceTimeSeriesQuery`
- View 型: `AccountBalanceListView`, `BalanceTimeSeriesView`, `AssetTotalView`
- ドメインイベント: `AccountBalanceUpdated`, `UnpaidBookkept`, `UnpaidSettled`, `NisaContributionAdded`

## 利用例

```ts
import {
  TransactionSchema,
  type Transaction,
  type TransactionRepository,
  type DashboardQuery,
} from '@household/domain'

// 集約の生成
const tx: Transaction = TransactionSchema.parse({
  kind: 'unclassified',
  common: {
    transactionId: '01HXYZ...',
    ownerUserId: '01ABCD...',
    merchantName: 'スーパーA',
    amount: 1500,
    occurredAt: new Date(),
    importSource: { kind: 'manual', enteredAt: new Date(), enteredByUserId: '01ABCD...' },
  },
  reason: 'merchant_rule_unlearned',
  defaultExpenseClass: 'personal_honey',
})

// Repository 利用（実装は Phase 5 の adapter 層）
async function example(repo: TransactionRepository) {
  await repo.save(tx)
  const found = await repo.findById(tx.common.transactionId)
}
```

## 開発コマンド

```bash
pnpm install              # 依存関係インストール
pnpm --filter @household/domain build      # TS ビルド
pnpm --filter @household/domain test       # Vitest 実行
pnpm --filter @household/domain typecheck  # tsc --noEmit
pnpm --filter @household/domain lint       # ESLint
```

ルートから一括:

```bash
pnpm build       # 全 workspace ビルド
pnpm test        # 全 workspace テスト
pnpm typecheck   # 全 workspace 型チェック
pnpm lint        # 全 workspace lint
```

## Phase 5 への引き継ぎ

- 残り 6 コンテキスト（取引取込 / 自動分類・学習 / 経費精算 / オンボーディング・認証 / 通知配信 / マスタ管理）の型化
- adapter 層の実装（`packages/adapters-*`）
- LIFF アプリ（`packages/web`）と Lambda handlers（`packages/api`）の追加
- ドメインイベントバスの実装（Phase 4 では型定義のみ）
- 詳細: [Phase 4 spec §13](../../docs/superpowers/specs/2026-05-01-phase4-tactical-design.md)
