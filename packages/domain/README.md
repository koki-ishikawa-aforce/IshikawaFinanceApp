# @warimaru/domain

全 8 境界づけられたコンテキストの TS 型 + Zod スキーマ + リポジトリ I/F + Query I/F。
Phase 4 で Core 2 コンテキスト、Phase 5 M-A で残り 6 コンテキストを型化した。

> **親 spec**: [docs/superpowers/specs/2026-05-01-phase4-tactical-design.md](../../docs/superpowers/specs/2026-05-01-phase4-tactical-design.md)
> **plan**: [docs/superpowers/plans/2026-05-01-phase4-tactical-implementation.md](../../docs/superpowers/plans/2026-05-01-phase4-tactical-implementation.md)（Phase 4）
> / [docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md](../../docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md)（Phase 5 M-A）

## 公開 API（barrel: `@warimaru/domain`）

### shared

- ID 型: `TransactionId`, `UserId`, `CategoryId`, `ExpenseTypeId`, `AccountId`, `MitsuiSumitomoUnpaidId`, `UnpaidEntryId`, `MonthlyReportId`, `ExpenseReimbursementId`, `SettlementNoticeId`, `GmailMessageId`,
  `TransactionCandidateId`, `ImportBatchId`, `ImportJobId`, `UploadFileId`, `PdfConversionJobId`, `AmazonOrderId`, `BulkClassificationSessionId`, `MonthlyExpenseCycleId`, `ChildTransactionId`, `ExpenseTypeAccumulationId`, `TalkRoomId`, `MonthlyLimitId`, `CategoryDeletionRequestId`, `ExpenseTypeDeletionRequestId`, `Phase0ConfigId`, `DeliveryMessageId`, `DeliveryLogId`, `FailsafeEmailId`, `LineMessageId`（および各 Schema）
- 値オブジェクト: `Money`, `YearMonth`, `ExpenseClass`, `ParameterStorePath`, `AmazonProductKey`, `UserRole`, `PersonalExpenseClass`（別名 `DefaultExpenseClass`。`roleToPersonalExpenseClass` / `assertPersonalExpenseClassMatchesRole` で所有者ロールとの整合を担保）
- 共有カーネル語彙（Phase 5 M-A で household-analysis から移設）: `UnclassifiedReason`, `ClassificationBasis`, `ImportSource`（メンバー schema 個別 export あり）, `UnapprovedExpenseTransfer`
- イベント基底: `DomainEventBase`
- イベントバス: `EventBus` / `EventHandler`（同期・インプロセス配信、publish はハンドラー完了を await）+ 実装 `InMemoryEventBus`（#34）
- エラー: `DomainError`, `InvariantViolationError`, `NotFoundError`, `PermissionDeniedError`

### household-analysis（家計分析）

- 集約: `Transaction`（`unclassified` / `classified` / `deleted`。未分類→分類 `classify` / 分類済み生成 `createClassifiedTransaction` / 削除 `deleteTransaction` を含む）, `MonthlyReport`（`csv_confirmed` / `finalized`。CSV確定昇格 `confirmCsv` / 再集計 `refreshCsvConfirmed` / 最終確定昇格 `finalize` / 取引集計 `aggregateMonthlyReportTotals`（`MonthlyReportTotals`）を含む）
- Repository I/F: `TransactionRepository`, `MonthlyReportRepository`
- Query I/F: `DashboardQuery`, `MonthlyReportQuery`, `TransactionListQuery`
- View 型: `DashboardKpisView`, `CategoryBreakdownView`, `MonthlyReportView`, `TransactionListItem`
- プライバシー: `ViewerContext`, `ViewerRole`（`applyPrivacyFilter` 関数群は内部実装、Query 実装層からのみ使用）
- ドメインイベント: `MonthlyReportCsvConfirmed`, `MonthlyReportFinalized`, `TransactionDeleted`, `TransactionManuallyClassified`（`ConfirmedClassification` を含む）

### balance-asset-tracking（残高・資産推移管理）

- 集約: `Account`（`smbc_bank` / `mitsui_sumitomo_card` / `other_savings` / `nisa`。SMBC 残高更新 `applySmbcBalanceChange`、口座登録 `registerOtherSavingsAccount` / `registerNisaAccount`、名称変更 `changeBankName` / `changeBrokerageName`、種別絞り込み `asOtherSavingsAccount` / `asNisaAccount` を含む）, `MitsuiSumitomoUnpaid`（未払金計上 `bookUnpaid` / 消込 `settleUnpaid` を含む）
- 値オブジェクト: `AccountKind`, `BankName`, `BrokerageName`（および `brokerageNameToDisplay`）
- Repository I/F: `AccountRepository`, `MitsuiSumitomoUnpaidRepository`
- Query I/F: `AccountBalanceQuery`, `BalanceTimeSeriesQuery`
- View 型: `AccountBalanceListView`, `BalanceTimeSeriesView`, `AssetTotalView`
- ドメインイベント: `AccountBalanceUpdated`, `AccountRegistered`, `InitialBalanceRegistered`, `BankNameChanged`, `BrokerageNameChanged`, `UnpaidBookkept`, `UnpaidSettled`, `NisaContributionAdded`

### auto-classification（自動分類・学習、08b）

- 集約: `MerchantLearningRule`（`active` / `disabled`、X-1: AMAZON.CO.JP 拒否。`reflectManualClassification` で手動修正を T-2 軸独立に即時反映。`applicableClassification` で学習済みルールから適用可能な分類を導出）, `AmazonProductKeyLearningRule`, `BulkClassificationSession`（`in_progress` / `completed` / `aborted`）
- 値オブジェクト: `CategoryLearningRef` ほか T-2 独立 3 軸, `ClassificationResult`, `AmazonMatchState`, `LearningAxis`, `ManualClassification`（UL「修正後分類」）+ `ReflectManualClassificationResult`
- Repository I/F: `MerchantLearningRuleRepository`, `AmazonProductKeyLearningRuleRepository`, `BulkClassificationSessionRepository`
- Query I/F: `RetroactiveCandidateQuery`（J-3）+ `RetroactiveCandidateView`
- ドメインイベント: `TransactionAutoClassified` ほか 9 種

### expense-settlement（経費精算、08e）

- 集約: `MonthlyExpenseCycle`（`accumulating` / `csv_confirmed` / `finalized`。`cycleExpenseTotal` / `calculateSettlementMatchDifference` で突合差額を算出）, `ProratedChildTransaction`, `ExpenseReimbursementDeposit`（`awaiting_match` / `matched` / `unrecognized_confirmed`）
- 値オブジェクト: `ExpenseTypeAccumulation`（`capped` / `unlimited`、論点15 構造分離）, `ExpenseJudgment`, `SettlementMatchDifference`
- Repository I/F: `MonthlyExpenseCycleRepository`, `ProratedChildTransactionRepository`, `ExpenseReimbursementDepositRepository`
- Query I/F: `ExpenseSettlementManagementQuery`（本人のみ可視・論点11）+ `ExpenseSettlementManagementView`
- ドメインサービス（複数集約を協調させる純粋関数。driven port と異なり実装もドメイン内）: `finalizeExpenseSettlement` / `settleDepositForFinalizedCycle`（`MonthlyExpenseCycle` × `ExpenseReimbursementDeposit` 2集約横断の最終確定検証・終端遷移、OQ-49 / #100）
- ドメインイベント: `MonthlyExpenseCycleStarted` ほか 11 種

### transaction-import（取引取込、08a）

- 集約: `TransactionCandidate`（`normal` / `amazon_matched` / `match_timeout`）, `DailyMailImportBatch`, `StatementImportJob`（`startPdfConversion` / `startFormatValidation` / `startImporting` / `updateProcessedCount` / `completeImportJob` / `failImportJob`）
- 値オブジェクト: `CandidateImportSource`, `AmazonOrderInfo`, `SmbcMailParseResult`, `DuplicationJudgment`, `ImportResultSummary`, `ImportJobFailureReason`, `PdfConversionFailureReason`（および `normalizeMerchantName` — OQ-23 加盟店名正規化）
- Repository I/F: `TransactionCandidateRepository`（GmailID / 三項一致検索）, `DailyMailImportBatchRepository`, `StatementImportJobRepository`
- Service I/F（ACL 翻訳層の driven port、実装は adapter 層）: `PdfToCsvConverter`（OQ-23、`ConvertedStatementRow` / `PdfToCsvConversion` を含む）
- Query I/F: `CsvImportStatusQuery` + `CsvImportCompletionView`
- ドメインイベント: `MailImportBatchLaunched` ほか 14 種

### onboarding-auth（オンボーディング・認証、08f）

- 集約: `AppUser`（`phase1_completed` → `phase2_in_progress` → `phase2_completed` → `operation_started`、論点8 順序強制。登録 `registerAppUser` / ニックネーム変更 `changeNickname` / LINE 運用設定の事前蓄積 `recordLineFriendAdded` / `recordTalkRoomJoined` / `activateNotification`（+ 読取り `lineOperationSettingsOf`、運用開始発火 `startOperation` で集約直下へ昇格）/ Phase2 セクション遷移 `completeSectionA` / `completeSectionB` / `completeSectionF` / `skipSectionF` / 配偶者完了検知 `detectSpouseCompletion`（論点19 の判定規約、Query 実装が共有）を含む）, `GmailOAuthToken`（`valid` / `revocation_detected`）
- 値オブジェクト: `Nickname`（≤10 文字・省略可、Phase 3.5）, `Phase2Progress`, `LineOperationSettings`, `RoleJudgment`（+ 役割判定 `judgeRole` / 配偶者ユーザーID導出 `resolveSpouseUserId`、許可リスト照合）, `SpouseCompletionResult`, `GmailOAuthTokenRef`, `InitialBalanceRegistrationRef`
- Repository I/F: `AppUserRepository`, `GmailOAuthTokenRepository`
- Service I/F（ACL 翻訳層の driven port、実装は api 層）: `GmailOAuthGateway`（OQ-7、トークン実体は Parameter Store へ保管しドメインはパスのみ受領）
- Query I/F: `SpouseCompletionQuery`（論点19: 画面ロード時のみ）
- ドメインイベント: `RoleJudged`, `GmailOauthRevocationDetected`（OAuth 所有者として一元宣言）ほか 20 種

### master-data（マスタ管理、08h）

- 集約: `CategoryMaster` / `ExpenseTypeMaster`（`default` / `custom`、規定は改名・削除関数なし。名前一意性は save 前に `assertCategoryNameAvailable` / `assertExpenseTypeNameAvailable` で検査）, `MonthlyLimit`（`capped` / `unlimited`、論点15）, `Phase0Config`（3 要素必須）
- 値オブジェクト: `OwnershipScope`（`assertVisibleTo` で所有スコープの閲覧可否を検証）, `RenameRecord`, `SeedLimit`, `DeletionRequestState`, `CategoryDeletionRequest`, `ExpenseTypeDeletionRequest`, `Allowlist`
- Repository I/F: `CategoryMasterRepository`, `ExpenseTypeMasterRepository`, `MonthlyLimitRepository`, `Phase0ConfigRepository`
- Query I/F: `AllowlistQuery`, `LineChannelConfigQuery`
- ドメインイベント: `CategorySeedInserted` ほか 17 種

### notification-delivery（通知配信、08g）

- 集約: `DeliveryMessage`（配信用途 × 配信先マトリクスを superRefine で強制。予約 `reserveDeliveryMessage` / 送信ライフサイクル遷移を含む）, `LineDeliveryLog`（不変監査レコード + 冪等性キー、OQ-34。終端状態からの組立 `createLineDeliveryLog`）, `FailsafeEmail`（予約 `reserveFailsafeEmail` / 送信ライフサイクル遷移を含む）
- 値オブジェクト: `DeliveryTarget`, `DeliveryContent`（OQ-39 サイズ検証は adapter 層）, `DeliveryPurpose`, `ConsecutiveFailureCounter`（失敗記録 `recordSendFailure` / 成功リセット `resetFailureCounter` / 発火判定 `shouldFireFailsafe` / 発火記録 `markFailsafeFired`。しきい値既定 3 = OQ-14）, `ReminderStopReason`
- Repository I/F: `DeliveryMessageRepository`, `LineDeliveryLogRepository`（append-only）, `FailsafeEmailRepository`, `ConsecutiveFailureCounterRepository`
- Service I/F（ACL 翻訳層の driven port、実装は api 層）: `LineMessagingGateway`（LINE push、トークン実体は Parameter Store 解決でドメインに持ち込まない）, `FailsafeEmailGateway`（SMTP / SES 等の標準送信プロバイダ、OQ-14）
- Query I/F: なし（CSV 取込完了状態の読取りは transaction-import 側の `CsvImportStatusQuery`）
- ドメインイベント: `DeliveryLogSaved` ほか 11 種

## 利用例

```ts
import {
  TransactionSchema,
  type Transaction,
  type TransactionRepository,
  type DashboardQuery,
} from '@warimaru/domain'

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

// Repository 利用（実装は Phase 5 M-B の adapter 層）
async function example(repo: TransactionRepository) {
  await repo.save(tx)
  const found = await repo.findById(tx.common.transactionId)
}
```

## 開発コマンド

```bash
pnpm install              # 依存関係インストール
pnpm --filter @warimaru/domain build      # TS ビルド
pnpm --filter @warimaru/domain test       # Vitest 実行
pnpm --filter @warimaru/domain typecheck  # tsc --noEmit
pnpm --filter @warimaru/domain lint       # ESLint
```

ルートから一括:

```bash
pnpm build       # 全 workspace ビルド
pnpm test        # 全 workspace テスト
pnpm typecheck   # 全 workspace 型チェック
pnpm lint        # 全 workspace lint
```

## Phase 5 M-B 以降への引き継ぎ

- adapter 層の実装（`packages/adapters-neon/`、Neon PostgreSQL。OQ-41: ID 生成方式の確定と `idSchema` 強化を含む）
- LIFF アプリ（`packages/web`）と Hono on Lambda（`packages/api`）の追加
- ドメインイベントバスの実装（OQ-42）→ #34 で同期・インプロセス配信（`InMemoryEventBus`）と API 層でのハンドラー登録を実装。EventBridge 等での非同期配信は #35 以降で検討
- OQ-38（SMBC URL 実調査）/ OQ-39（Flex Message サイズ検証）のクローズ
- 詳細: [Phase 4 spec §13](../../docs/superpowers/specs/2026-05-01-phase4-tactical-design.md) / [ロードマップ §2](../../docs/superpowers/plans/2026-07-06-forward-roadmap.md)
