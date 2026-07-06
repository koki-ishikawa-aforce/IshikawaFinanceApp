# Phase 5 M-A: 残り 6 コンテキストの型化 — 実装計画

> 作成: 2026-07-06
> 親ロードマップ: [2026-07-06-forward-roadmap.md §2 M-A](./2026-07-06-forward-roadmap.md)
> 親 spec: [Phase 4 戦術的設計 §13.1](../specs/2026-05-01-phase4-tactical-design.md)
> 対象ブランチ: `claude/phase-5-context-typing-5gxvi0`

## 0. スコープ

Phase 4 で確立したパターン（discriminated union 集約 + Zod superRefine + branded ID +
Repository/Query I/F 分離 + View 型 + ドメインイベント型 + 不変条件テスト）を残り 6 コンテキストへ展開する。

- 型定義のみ。adapter 実装・イベントバス・mock は M-B 以降
- OQ-41（ULID）先送り: `idSchema = z.string().min(1)` を維持
- OQ-38（SMBC URL 実調査）/ OQ-39（Flex Message サイズ検証）は外部調査のため本マイルストーンのスコープ外
  （型は `linkUrl` / `flexPayloadJson` をプレーン文字列でモデル化し、JSDoc に先送りを注記）

実装順（Core → Supporting → Generic、ロードマップ準拠）:

1. 自動分類・学習 `auto-classification`（08b, Core）
2. 経費精算 `expense-settlement`（08e, Core）
3. 取引取込 `transaction-import`（08a, Supporting）
4. オンボーディング・認証 `onboarding-auth`（08f, Supporting）
5. マスタ管理 `master-data`（08h, Supporting）
6. 通知配信 `notification-delivery`（08g, Generic）

## 1. 共有カーネル規則（Step 0）

**コンテキストは兄弟コンテキストの `src/` を import しない。2 コンテキスト以上で使う型は `src/shared/` に置く。**

公開 API はフラット barrel（`src/index.ts` の `export *`）のため、エクスポート名は全コンテキストで
グローバル一意でなければならない。あいまいな `export *` は TypeScript が黙って落とすため、
`tests/smoke/public-api.test.ts` を衝突ガードとして必ず拡張する。

### 1.1 shared へ移設する既存型（エクスポート名は不変 = 公開 API 非破壊）

| 型 | 移設元 | 移設先 / 型強化 |
|---|---|---|
| `UnclassifiedReason` | household-analysis/aggregates/Transaction.ts | shared/value-objects/UnclassifiedReason.ts |
| `ClassificationBasis` | household-analysis/value-objects/ | shared/value-objects/。`bulkSessionId` → `BulkClassificationSessionIdSchema`、`amazonProductKey` → `AmazonProductKeySchema` |
| `ImportSource` | household-analysis/value-objects/ | shared/value-objects/。メンバー schema 6 種を個別 export。`csvFileId`/`pdfFileId` → `UploadFileIdSchema`、`amazonOrderId` → `AmazonOrderIdSchema`、pdf に `pdfConversionJobId?` 追加 |
| `UnapprovedExpenseTransfer` | household-analysis/aggregates/MonthlyReport.ts | shared/value-objects/。`transferTarget` → `PersonalExpenseClassSchema` |
| `ViewerRole` | household-analysis/privacy/ViewerContext.ts | shared の `UserRoleSchema` の別名として再定義（値空間は 1 つ） |

### 1.2 新規 shared VO

- `ParameterStorePath`（branded string）— 08f / 08h / 08g で使用
- `AmazonProductKey`（branded string）— 08a / 08b / ClassificationBasis で使用
- `UserRole = z.enum(['honey','darling'])`（08f 役割）
- `PersonalExpenseClass = z.enum(['personal_honey','personal_darling'])` + 別名 `DefaultExpenseClass`

### 1.3 追加 branded ID（shared/ids.ts、19 種）

| コンテキスト | ID |
|---|---|
| 取引取込 | TransactionCandidateId, ImportBatchId, ImportJobId, UploadFileId, PdfConversionJobId, AmazonOrderId |
| 自動分類・学習 | BulkClassificationSessionId |
| 経費精算 | MonthlyExpenseCycleId, ChildTransactionId, ExpenseTypeAccumulationId |
| オンボーディング・認証 | TalkRoomId（通知配信と共用） |
| マスタ管理 | MonthlyLimitId, CategoryDeletionRequestId, ExpenseTypeDeletionRequestId, Phase0ConfigId |
| 通知配信 | DeliveryMessageId, DeliveryLogId, FailsafeEmailId, LineMessageId |

ID を作らないもの: 加盟店学習ルール / Amazon商品キー学習ルール（自然キー、09-aggregates #4/#5）、
LineUserId（OQ-15: ユーザーID = LINE userID）、GmailOAuthTokenId（UserId キー）。

## 2. コンテキスト別設計サマリ

各コンテキストの集約・不変条件・イベントの詳細は各 UL ドキュメント（08a/08b/08e/08f/08g/08h）と
[09-aggregates.md](../../domain/09-aggregates.md) を正とする。実装上の主要判断:

### 2.1 auto-classification（08b）

- 集約: `MerchantLearningRule`（active|disabled、自然キー userId+加盟店名）/
  `AmazonProductKeyLearningRule` / `BulkClassificationSession`（in_progress|completed|aborted）
- T-2 フィールド独立は `CategoryLearningRef` / `ExpenseClassLearningRef` / `ExpenseTypeLearningRef` の
  各 learned|unlearned union で表現
- superRefine: X-1 — `merchantName === 'AMAZON.CO.JP'` は加盟店学習ルールとして拒否
- 再有効化（`reenableMerchantLearning`）後のルールは全 ref が unlearned

### 2.2 expense-settlement（08e）

- 集約: `MonthlyExpenseCycle`（accumulating|csv_confirmed|finalized）/ `ProratedChildTransaction` /
  `ExpenseReimbursementDeposit`（awaiting_match|matched|unrecognized_confirmed）
- 論点 15: `ExpenseTypeAccumulation` の unlimited は `.strict()` で上限フィールドを構造的に排除
- superRefine: capped の `currentTotal ≤ monthlyCap` / `currentTotal = Σ 経費充当分` /
  `ProratedChildTransaction.personalAmount > 0`
- `ExpenseSettlementManagementView` は本人のみ可視（論点 11。adapter は配偶者アクセスに
  `PermissionDeniedError` を投げる旨を JSDoc に明記）
- 充当判定（AllocationJudgment）は behavior 内部結果のため型化しない（M-B のアプリ層関心）

### 2.3 transaction-import（08a）

- 集約: `TransactionCandidate`（normal|amazon_matched|match_timeout）/
  `DailyMailImportBatch`（started|importing|completed|failed）/
  `StatementImportJob`（upload_accepted|pdf_converting|format_validating|importing|completed|failed）
- superRefine: amazon_matched ⇒ importSource.kind='amazon_match' / バッチ対象期間 from < to /
  pdf_converting ⇒ fileFormat='pdf'
- `launchImportJob` が PDF→pdf_converting / CSV→format_validating のルーティングを型遷移で表現
- 08a のイベント重複ペア（バッチ起動×2、重複除外×2）は統合し、判断を JSDoc に記録
- `GmailOauthRevocationDetected` イベントは OAuth ライフサイクル所有者の onboarding-auth 側で宣言

### 2.4 onboarding-auth（08f）

- 集約: `AppUser`（phase1_completed|phase2_in_progress|phase2_completed|operation_started）/
  `GmailOAuthToken`（valid|revocation_detected）
- Phase 3.5 反映: `role: UserRole`（honey|darling）、`nickname?`（≤10 文字、省略可。
  表示フォールバックは UI 関心のため JSDoc 注記のみ）
- superRefine: 論点 8 — SectionB 完了 ⇒ SectionA 完了、SectionC/D/E 確認 ⇒ SectionB 完了。
  SectionF は前提条件なし（08f に事前条件記載なし）
- `completePhase2` は SectionA/B 未完なら `InvariantViolationError`
- LIFF セッション等の ACL データは M-A 対象外（adapter 層関心）

### 2.5 master-data（08h）

- 集約: `CategoryMaster`（default|custom）/ `ExpenseTypeMaster`（同構造）/
  `MonthlyLimit`（capped|unlimited、unlimited は `.strict()`・論点 15）/ `Phase0Config`（3 設定必須）
- 規定マスタの改名・削除関数を提供しない = 不変性の構造表現
- superRefine: default ⇒ household_shared スコープ / custom ⇒ personal スコープ
- 削除リクエスト 2 種は 09-aggregates 上の集約でないため value-objects として型化

### 2.6 notification-delivery（08g）

- 集約: `DeliveryMessage`（reserved|sending|sent|failed|skipped）/
  `LineDeliveryLog`（遷移関数なしの不変監査レコード + 冪等性キー、OQ-34）/ `FailsafeEmail`
- superRefine: 配信用途×配信先マトリクス（個人サマリ・OAuth失効 ⇒ personal_dm、
  リマインダー・世帯サマリ・テスト ⇒ shared_talk_room）
- `ConsecutiveFailureCounter` は VO（しきい値到達 → フェイルセーフ発火状態を内包）
- Query なし（唯一の読取り = CSV 取込完了状態は transaction-import の `CsvImportStatusQuery` が担う）

## 3. テスト計画

- 集約 17 種すべてに `tests/<ctx>/aggregates/*.test.ts`（parse 成功/失敗ペア、`as never` fixture）
- VO 不変条件テスト 4 本: ClassificationResult / ExpenseTypeAccumulation / LineOperationSettings /
  ConsecutiveFailureCounter
- `.strict()`（論点 15）は余剰キー付き fixture で失敗を確認
- smoke test にコンテキストごとの代表 schema（全集約 + VO 1 種以上 + イベント 1 種以上）を追加

## 4. コミット計画

Phase 4 と同様の小さいコミット。コンテキストごとに repo green を維持:

1. `docs(plans)`: 本計画
2. `feat(domain/shared)`: branded ID 19 種 + 新規共有 VO
3. `refactor(domain/shared)`: 共有カーネル VO の移設（household-analysis 配線替え含む）
4. 以降コンテキストごとに: 値オブジェクト → 集約+テスト → Repository I/F → Query I/F + View →
   イベント + barrel（`src/index.ts` / smoke test 拡張を含む）
5. 最後に `docs(plans)`: ロードマップの M-A チェックボックス反映

## 5. DoD

- `pnpm build` / `typecheck` / `test` / `lint` / `format:check` すべて green
- 全 8 コンテキストが `@warimaru/domain` から export され、smoke test が import を検証
- 集約 17 種すべてに不変条件テストがあり、全 superRefine に失敗系テストがある
- PR 上で CI green
