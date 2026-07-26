# @warimaru/domain

全 8 境界づけられたコンテキストの TS 型 + Zod スキーマ + リポジトリ I/F + Query I/F。
Phase 4 で Core 2 コンテキスト、Phase 5 M-A で残り 6 コンテキストを型化した。

> **親 spec**: [docs/superpowers/specs/2026-05-01-phase4-tactical-design.md](../../docs/superpowers/specs/2026-05-01-phase4-tactical-design.md)
> **plan**: [docs/superpowers/plans/2026-05-01-phase4-tactical-implementation.md](../../docs/superpowers/plans/2026-05-01-phase4-tactical-implementation.md)（Phase 4）
> / [docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md](../../docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md)（Phase 5 M-A）

## 公開 API（barrel: `@warimaru/domain`）

### shared

- ID 型: `TransactionId`, `UserId`, `CategoryId`, `ExpenseTypeId`, `AccountId`, `BankDepositId`, `MitsuiSumitomoUnpaidId`, `UnpaidEntryId`, `MonthlyReportId`, `ExpenseReimbursementId`, `SettlementNoticeId`, `GmailMessageId`,
  `TransactionCandidateId`, `ImportBatchId`, `ImportJobId`, `UploadFileId`, `PdfConversionJobId`, `AmazonOrderId`, `BulkClassificationSessionId`, `MonthlyExpenseCycleId`, `ChildTransactionId`, `ExpenseTypeAccumulationId`, `TalkRoomId`, `MonthlyLimitId`, `CategoryDeletionRequestId`, `ExpenseTypeDeletionRequestId`, `Phase0ConfigId`, `DeliveryMessageId`, `DeliveryLogId`, `FailsafeEmailId`, `LineMessageId`（および各 Schema）
- 値オブジェクト: `Money`, `YearMonth`（および JST 暦日ヘルパー `jstCalendarParts` / `jstYearMonthOf`）, `normalizeJapaneseName`（OQ-7 / OQ-23 の名称正規化。加盟店名・振込元名の正規化が委譲する単一実装）, `ExpenseClass`, `ParameterStorePath`, `AmazonProductKey`, `UserRole`, `PersonalExpenseClass`（別名 `DefaultExpenseClass`。`roleToPersonalExpenseClass` / `assertPersonalExpenseClassMatchesRole` で所有者ロールとの整合を担保）
- 共有カーネル語彙（Phase 5 M-A で household-analysis から移設）: `UnclassifiedReason`, `ClassificationBasis`, `ImportSource`（メンバー schema 個別 export あり）, `UnapprovedExpenseTransfer`
- イベント基底: `DomainEventBase`
- イベントバス: `EventBus` / `EventHandler`（同期・インプロセス配信、publish はハンドラー完了を await）+ 実装 `InMemoryEventBus`（#34）
- エラー: `DomainError`, `InvariantViolationError`, `NotFoundError`, `PermissionDeniedError`, `UnpaidAlreadyBookedError` / `UnpaidSettlementAlreadyAppliedError` / `OtherSavingsMovementAlreadyAppliedError`（いずれも `InvariantViolationError` の派生。冪等ガードの「適用済み」をメッセージ文言ではなく型で判別するため、#388 / #390）

### household-analysis（家計分析）

- 集約: `Transaction`（`unclassified` / `classified` / `deleted`。未分類→分類 `classify` / 分類済み生成 `createClassifiedTransaction` / 削除 `deleteTransaction` を含む）, `MonthlyReport`（`csv_confirmed` / `finalized`。CSV確定昇格 `confirmCsv` / 再集計 `refreshCsvConfirmed` / 最終確定昇格 `finalize` / 取引集計 `aggregateMonthlyReportTotals`（`MonthlyReportTotals`）を含む）
- Repository I/F: `TransactionRepository`, `MonthlyReportRepository`
- 値オブジェクト: `BalanceFreshness`（残高鮮度評価。`BalanceFreshnessStatus` = `ok` / `alert`、閾値の単一ソース `BALANCE_FRESHNESS_THRESHOLD_DAYS` = 35（OQ-44）、評価関数 `evaluateBalanceFreshness`。根拠の最終更新日時は残高・資産推移管理から借用し、判定は本コンテキストが持つ — 08c / 08d L244）
- Query I/F: `DashboardQuery`（KPI・カテゴリ内訳に加え、残高鮮度評価リスト `fetchBalanceFreshness` を提供。残高は世帯フルオープンのため viewerId を取らない）, `MonthlyReportQuery`, `TransactionListQuery`
- View 型: `DashboardKpisView`, `CategoryBreakdownView`, `BalanceFreshnessListView`（+ `BalanceFreshnessItem`）, `MonthlyReportView`, `TransactionListItem`
- プライバシー: `ViewerContext`, `ViewerRole`（`applyPrivacyFilter` 関数群は内部実装、Query 実装層からのみ使用）
- ドメインイベント: `MonthlyReportCsvConfirmed`, `MonthlyReportFinalized`, `TransactionDeleted`, `TransactionManuallyClassified`（`ConfirmedClassification` + `amazonProductKey?`（X-1 商品キー。下流の自動分類・学習が消費）を含む）, `CategoryTransactionsRemapped`（マスタ削除リマップの家計分析完了通知）

### balance-asset-tracking（残高・資産推移管理）

- 集約: `Account`（`smbc_bank` / `mitsui_sumitomo_card` / `other_savings` / `nisa`。SMBC 残高更新 `applySmbcBalanceChange`、別銀行貯蓄（シャドウ）残高の手入力更新 `applyOtherSavingsBalanceChange` / 取引由来の更新 `applyOtherSavingsMovement`（同一 `transactionId` の再適用を拒否）、引落消込の残高反映 `applyUnpaidSettlementToSmbcBalance`（同一 `settlementNoticeId` の再反映を拒否）、口座登録 `registerOtherSavingsAccount` / `registerNisaAccount`、名称変更 `changeBankName` / `changeBrokerageName`、種別絞り込み `asOtherSavingsAccount` / `asNisaAccount` を含む）, `BankDeposit`（入金変動 + 入金用途判別結果。`salary` / `expense_reimbursement` / `other_savings_return` / `unknown`。判別結果の記録 `recordBankDeposit` / 手動確認による確定 `confirmBankDepositPurpose`（本人のみ・別用途への変更は不可。同じ用途での再確定は冪等で、反映の前方回復の入口） / 確定判定 `isDeterminedBankDeposit` / 可視判定 `canViewBankDeposit` を含む。確定経路 `DeterminationSource`（`automatic` / `manual`）を保持）, `MitsuiSumitomoUnpaid`（未払金計上 `bookUnpaid` / 消込 `settleUnpaid` / 通知別の消込エントリ `settledEntriesForNotice` / 消込合計 `settledTotalForNotice` を含む）
- 値オブジェクト: `AccountKind`, `BankName`, `BrokerageName`（および `brokerageNameToDisplay`）, `DepositPurpose` / `DeterminedDepositPurpose` / `ProvisionalHandling`, `WithdrawalPurpose` / `OtherSavingsCounterpartyNames`, `BankDepositPurposeRule`（組立 `bankDepositPurposeRule` + 既定値 `DEFAULT_SALARY_PAYOUT_DAY_WINDOW` / `DEFAULT_SALARY_THRESHOLD_AMOUNT`）, `normalizeRemitterName`
- ドメインサービス: `determineBankDepositPurpose`（OQ-21 の入金日 + 金額 2 シグナル判別。矛盾時は用途不明 = 手動確認待ち）, `determineWithdrawalPurpose`, `applyOtherSavingsReturn` / `applyOtherSavingsTransfer`（シャドウ残高への資金移動。金額は正・向きは関数側が決める）
- Repository I/F: `AccountRepository`, `BankDepositRepository`, `MitsuiSumitomoUnpaidRepository`
- Query I/F: `AccountBalanceQuery`, `BalanceTimeSeriesQuery`
- View 型: `AccountBalanceListView`（`other_savings` は最終更新日時までを供給し、鮮度の経過日数・状態は持たない — 08d L244）, `BalanceTimeSeriesView`, `AssetTotalView`
- ドメインイベント: `AccountBalanceUpdated`, `AccountRegistered`, `InitialBalanceRegistered`, `BankNameChanged`, `BrokerageNameChanged`, `UnpaidBookkept`, `UnpaidSettled`, `NisaContributionAdded`, `BankDepositPurposeDetermined`, `ExpenseReimbursementDepositArrived`（08e の「経費精算入金を受信する」を起動する上流トリガー。08e が発行する `ExpenseReimbursementDepositReceived` とは別物）

### auto-classification（自動分類・学習、08b）

- 集約: `MerchantLearningRule`（`active` / `disabled`、X-1: AMAZON.CO.JP 拒否。`reflectManualClassification` で手動修正を T-2 軸独立に即時反映。`applicableClassification` で学習済みルールから適用可能な分類を導出）, `AmazonProductKeyLearningRule`（X-1: AMAZON.CO.JP の受け皿。`reflectAmazonProductKeyManualClassification` で商品キー別に T-2 軸独立に即時反映。`applicableAmazonProductKeyClassification` で適用可能な分類を導出）, `BulkClassificationSession`（`in_progress` / `completed` / `aborted`）
- 値オブジェクト: `CategoryLearningRef` ほか T-2 独立 3 軸（`LearningRefs` 束 + `deriveLearnedRefs` / `applicableClassificationFromRefs` を加盟店/Amazon 両学習で共有）, `ClassificationResult`, `AmazonMatchState`, `LearningAxis`, `ManualClassification`（UL「修正後分類」）+ `ReflectManualClassificationResult` / `ReflectAmazonProductKeyClassificationResult`
- Repository I/F: `MerchantLearningRuleRepository`, `AmazonProductKeyLearningRuleRepository`, `BulkClassificationSessionRepository`
- Query I/F: `RetroactiveCandidateQuery`（J-3）+ `RetroactiveCandidateView`
- ドメインイベント: `TransactionAutoClassified` ほか 11 種（マスタ削除リマップの自動分類学習完了通知 `CategoryLearningRulesRemapped` / `ExpenseTypeLearningRulesRemapped` を含む）

### expense-settlement（経費精算、08e）

- 集約: `MonthlyExpenseCycle`（`accumulating` / `csv_confirmed` / `finalized`。`cycleExpenseTotal` / `calculateSettlementMatchDifference` で突合差額を算出）, `ProratedChildTransaction`, `ExpenseReimbursementDeposit`（`awaiting_match` / `matched` / `unrecognized_confirmed`）
- 値オブジェクト: `ExpenseTypeAccumulation`（`capped` / `unlimited`、論点15 構造分離）, `ExpenseJudgment`, `SettlementMatchDifference`
- Repository I/F: `MonthlyExpenseCycleRepository`, `ProratedChildTransactionRepository`, `ExpenseReimbursementDepositRepository`
- Query I/F: `ExpenseSettlementManagementQuery`（本人のみ可視・論点11）+ `ExpenseSettlementManagementView`
- ドメインサービス（複数集約を協調させる純粋関数。driven port と異なり実装もドメイン内）: `finalizeExpenseSettlement` / `settleDepositForFinalizedCycle`（`MonthlyExpenseCycle` × `ExpenseReimbursementDeposit` 2集約横断の最終確定検証・終端遷移、OQ-49 / #100）, `recalculateAccumulationForCapChange`（月次上限変更時の `ExpenseTypeAccumulation` FIFO 按分再計算、#140）
- ドメインイベント: `MonthlyExpenseCycleStarted` ほか 11 種

### transaction-import（取引取込、08a）

- 集約: `TransactionCandidate`（`normal` / `amazon_matched` / `match_timeout`）, `DailyMailImportBatch`, `StatementImportJob`（`startPdfConversion` / `startFormatValidation` / `startImporting` / `updateProcessedCount` / `completeImportJob` / `failImportJob`）
- 値オブジェクト: `CandidateImportSource`, `AmazonOrderInfo`, `SmbcMailParseResult`, `DuplicationJudgment`, `ImportResultSummary`, `ImportJobFailureReason`, `PdfConversionFailureReason`（および `normalizeMerchantName` — OQ-23 加盟店名正規化）
- Repository I/F: `TransactionCandidateRepository`（GmailID / 三項一致検索）, `DailyMailImportBatchRepository`, `StatementImportJobRepository`
- Service I/F（ACL 翻訳層の driven port、実装は adapter 層）: `PdfToCsvConverter`（OQ-23、`ConvertedStatementRow` / `PdfToCsvConversion` を含む）, `GmailMailFetchGateway`（#412、実装は api 層。取込対象期間の SMBC 通知メール / Amazon 注文確認メールをパース前の外部表現のまま取得する。`MailFetchRequest`（トークン保管参照 + 取込対象期間）/ `MailFetchResult` / `SmbcNotificationMailBody` / `AmazonOrderConfirmationMailBody` / `MailKindHint` / `MailFetchFailure` を含む。失敗は例外ではなく戻り値で返し、トークン失効 `oauth_revocation_detected` をその他の取得失敗 `other_fetch_failure` と型で区別する — 失効は再認可導線 #392 の起点）
- Query I/F: `CsvImportStatusQuery` + `CsvImportCompletionView`
- ドメインイベント: `MailImportBatchLaunched` / `CardUsageTransactionImported` / `SettlementNoticeReceived` ほか 13 種

### onboarding-auth（オンボーディング・認証、08f）

- 集約: `AppUser`（`phase1_completed` → `phase2_in_progress` → `phase2_completed` → `operation_started`、論点8 順序強制。登録 `registerAppUser` / ニックネーム変更 `changeNickname` / LINE 運用設定の事前蓄積 `recordLineFriendAdded` / `activateNotification`（世帯の `SharedTalkRoom` を受け取り 2 集約横断の不変条件を強制。+ 読取り `lineOperationSettingsOf`、運用開始発火 `startOperation` で集約直下へ昇格）/ Phase2 セクション遷移 `completeSectionA` / `completeSectionB` / `completeSectionF` / `skipSectionF` / 配偶者完了検知 `detectSpouseCompletion`（論点19 の判定規約、Query 実装が共有）を含む）, `GmailOAuthToken`（`valid` / `revocation_detected`）, `SharedTalkRoom`（世帯レベル・シングルトンの共通トークルーム参加状態 `not_joined` / `joined`。参加記録 `recordSharedTalkRoomJoined` / 読取り `joinedTalkRoomIdOf` / 既定値 `NOT_JOINED_SHARED_TALK_ROOM`。OQ-55 ①）
- 値オブジェクト: `Nickname`（≤10 文字・省略可、Phase 3.5）, `Phase2Progress`, `LineOperationSettings`（友達追加 × 通知機能有効化。共通トークルーム参加は `SharedTalkRoom` へ分離済み。有効化記録は有効化日時のみを持ち、共通トークルームID は持たない — 保持する置き場は `SharedTalkRoom` 1 か所、#334）, `RoleJudgment`（+ 役割判定 `judgeRole` / 配偶者ユーザーID導出 `resolveSpouseUserId`、許可リスト照合）, `SpouseCompletionResult`, `GmailOAuthTokenRef`, `InitialBalanceRegistrationRef`
- Repository I/F: `AppUserRepository`, `GmailOAuthTokenRepository`, `SharedTalkRoomRepository`（世帯で 1 件のため引数なしの `find()` / `save()`）
- Service I/F（ACL 翻訳層の driven port、実装は api 層）: `GmailOAuthGateway`（OQ-7、トークン実体は Parameter Store へ保管しドメインはパスのみ受領）, `LineFriendshipGateway`（OQ-55 ③、新規登録完了時に友だち状態を照会して登録前 follow の取りこぼしを拾う。結果は `LineFriendshipStatus` = `friend` / `not_friend` / `unknown`。照会失敗は例外ではなく `unknown` で返し `not_friend` と区別する）, `LineTalkRoomMembershipGateway`（OQ-55 ① / #371、join Webhook で参加を記録する前に招待されたトークルームへの在籍を照会する。結果は `LineTalkRoomMembershipStatus` = `member` / `not_member` / `unknown`。照会失敗は `unknown` で返し `not_member` と区別し、`unknown` は `retryable` で一時障害と恒久的な失敗を分ける。`LineTalkRoomKind`（`group` / `room`）・`LineTalkRoomMembershipCheck`（照会 1 回分の入力）を含む）, `decideSharedTalkRoomJoin` / `requiresTalkRoomMembershipCheck`（OQ-55 ① / #371、join Webhook 由来の参加記録の可否判定。`SharedTalkRoomJoinVerdict` = `record` / `skip` / `retry_later`）
- ドメインサービス（集約横断の判定。application 層が保存とイベント発行を行う）: `decideOperationStart`（論点16、夫婦 2 人の `AppUser` が揃って Phase2 完了なら運用開始済みへ遷移させる。`HouseholdMembers` / `OperationStartedHousehold` / `OperationStartDecision` を含む。片方のみ完了では発火しない）, `decideHouseholdNotificationActivation`（08f §2「通知機能を有効化する」。両者運用開始済み・友達追加済み・世帯が共通トークルーム参加済みで有効化し、配信先は `SharedTalkRoom` から取る）, `isHouseholdNotificationActive`（世帯として有効化済みか。通知機能有効化イベントの二重発行防止に使う）
- Query I/F: `SpouseCompletionQuery`（論点19: 画面ロード時のみ）
- ドメインイベント: `RoleJudged`, `GmailOauthRevocationDetected`（OAuth 所有者として一元宣言）ほか 20 種

### master-data（マスタ管理、08h）

- 集約: `CategoryMaster` / `ExpenseTypeMaster`（`default` / `custom`、規定は改名・削除関数なし。名前一意性は save 前に `assertCategoryNameAvailable` / `assertExpenseTypeNameAvailable` で検査。規定の seed 投入は `seedDefaultCategory` / `seedDefaultExpenseType`、規定名の正は `DEFAULT_CATEGORY_NAMES` / `DEFAULT_EXPENSE_TYPE_NAMES`）, `MonthlyLimit`（`capped` / `unlimited`、論点15。seed 投入は `seedMonthlyLimit` + ロール別既定値 `defaultSeedLimitFor`）, `Phase0Config`（3 要素必須）
- 値オブジェクト: `OwnershipScope`（`assertVisibleTo` で所有スコープの閲覧可否を検証）, `RenameRecord`, `SeedLimit`, `DeletionRequestState`, `CategoryDeletionRequest`, `ExpenseTypeDeletionRequest`, `Allowlist`
- Repository I/F: `CategoryMasterRepository`, `ExpenseTypeMasterRepository`, `MonthlyLimitRepository`, `Phase0ConfigRepository`
- Query I/F: `AllowlistQuery`, `LineChannelConfigQuery`
- ドメインイベント: `CategorySeedInserted` ほか 17 種

### notification-delivery（通知配信、08g）

- 集約: `DeliveryMessage`（配信用途 × 配信先マトリクスを superRefine で強制。予約 `reserveDeliveryMessage` / 送信ライフサイクル遷移を含む）, `LineDeliveryLog`（不変監査レコード + 冪等性キー、OQ-34。終端状態からの組立 `createLineDeliveryLog`）, `FailsafeEmail`（予約 `reserveFailsafeEmail` / 送信ライフサイクル遷移を含む）
- 値オブジェクト: `DeliveryTarget`, `DeliveryContent`（OQ-39 サイズ検証は解決済み: 最大 2.6KB で上限に余裕あり）, `DeliveryPurpose`, `ConsecutiveFailureCounter`（失敗記録 `recordSendFailure` / 成功リセット `resetFailureCounter` / 発火判定 `shouldFireFailsafe` / 発火記録 `markFailsafeFired`。しきい値既定 3 = OQ-14）, `ReminderStopReason`, `ReminderContinuationJudgment`（リマインダー停止判定 `judgeReminderContinuation` / 世帯としての合成 `combineReminderJudgments` / 配信開始日 `REMINDER_START_DAY_OF_MONTH` = 5）
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

- adapter 層の実装（`packages/adapters-postgres/`、Neon PostgreSQL。OQ-41: ID 生成方式の確定と `idSchema` 強化を含む）
- LIFF アプリ（`packages/web`）と Hono on Lambda（`packages/api`）の追加
- ドメインイベントバスの実装（OQ-42）→ #34 で同期・インプロセス配信（`InMemoryEventBus`）と API 層でのハンドラー登録を実装。EventBridge 等での非同期配信は #35 以降で検討
- ~~OQ-38（SMBC URL 実調査）/ OQ-39（Flex Message サイズ検証）のクローズ~~ → **完了**（#52、2026-07-24）。OQ-44（鮮度アラート閾値 = 35 日）も併せてクローズ済み
- 詳細: [Phase 4 spec §13](../../docs/superpowers/specs/2026-05-01-phase4-tactical-design.md) / [ロードマップ §2](../../docs/superpowers/plans/2026-07-06-forward-roadmap.md)
