# @warimaru/domain

全 8 境界づけられたコンテキストの TS 型 + Zod スキーマ + リポジトリ I/F + Query I/F。
Phase 4 で Core 2 コンテキスト、Phase 5 M-A で残り 6 コンテキストを型化した。

> **親 spec**: [docs/superpowers/specs/2026-05-01-phase4-tactical-design.md](../../docs/superpowers/specs/2026-05-01-phase4-tactical-design.md)
> **plan**: [docs/superpowers/plans/2026-05-01-phase4-tactical-implementation.md](../../docs/superpowers/plans/2026-05-01-phase4-tactical-implementation.md)（Phase 4）
> / [docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md](../../docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md)（Phase 5 M-A）

## 公開 API（barrel: `@warimaru/domain`）

### shared

- ID 型: `TransactionId`, `UserId`, `CategoryId`, `ExpenseTypeId`, `AccountId`, `BankDepositId`, `MitsuiSumitomoUnpaidId`, `UnpaidEntryId`, `BalanceHistoryEntryId`, `MonthlyReportId`, `ExpenseReimbursementId`, `SettlementNoticeId`, `GmailMessageId`,
  `TransactionCandidateId`, `ImportBatchId`, `ImportJobId`, `UploadFileId`, `PdfConversionJobId`, `AmazonOrderId`, `BulkClassificationSessionId`, `MonthlyExpenseCycleId`, `ChildTransactionId`, `ExpenseTypeAccumulationId`, `TalkRoomId`, `MonthlyLimitId`, `CategoryDeletionRequestId`, `ExpenseTypeDeletionRequestId`, `Phase0ConfigId`, `DeliveryMessageId`, `DeliveryLogId`, `FailsafeEmailId`, `LineMessageId`（および各 Schema）
- 値オブジェクト: `Money`, `YearMonth`（および JST 暦日ヘルパー `jstCalendarParts` / `jstYearMonthOf` / `utcMidnightOfJstCalendarDate`（取込側の発生日表現。時刻を持たない取込元は暦日を UTC 深夜 0 時で表す）/ `utcInstantOfJstDateTime`（時刻まで分かる取込元の実時刻）/ `jstMonthStart` / `jstNextMonthStart`（JST 暦月の範囲。上端は「未満」で使う））, `normalizeJapaneseName`（OQ-7 / OQ-23 の名称正規化。加盟店名・振込元名の正規化が委譲する単一実装）, `ExpenseClass`, `ParameterStorePath`, `UserRole`, `PersonalExpenseClass`（別名 `DefaultExpenseClass`。`roleToPersonalExpenseClass` / `assertPersonalExpenseClassMatchesRole` で所有者ロールとの整合を担保）
- 共有カーネル語彙（Phase 5 M-A で household-analysis から移設）: `UnclassifiedReason`, `ClassificationBasis`, `ImportSource`（メンバー schema 個別 export あり）, `UnapprovedExpenseTransfer`
- イベント基底: `DomainEventBase`
- イベントバス: `EventBus` / `EventHandler`（同期・インプロセス配信、publish はハンドラー完了を await）+ 実装 `InMemoryEventBus`（#34）
- エラー: `DomainError`, `InvariantViolationError`, `NotFoundError`, `PermissionDeniedError`, `UnpaidAlreadyBookedError` / `UnpaidSettlementAlreadyAppliedError` / `OtherSavingsMovementAlreadyAppliedError`（いずれも `InvariantViolationError` の派生。冪等ガードの「適用済み」をメッセージ文言ではなく型で判別するため、#388 / #390）, `ConcurrentUpdateError`（`DomainError` 直系。楽観ロックの版数照合で書き込みを拒否したことを型で判別する。不変条件違反ではなく、やり直せば通る一時的な並行更新競合、#459）

### household-analysis（家計分析）

- 集約: `Transaction`（`unclassified` / `classified` / `deleted`。未分類→分類 `classify` / 分類済み生成 `createClassifiedTransaction` / 削除 `deleteTransaction` を含む）, `MonthlyReport`（`csv_confirmed` / `finalized`。CSV確定昇格 `confirmCsv` / 再集計 `refreshCsvConfirmed` / 最終確定昇格 `finalize` / 取引集計 `aggregateMonthlyReportTotals`（`MonthlyReportTotals`）/ 残高の凍結 `freezeBalanceSnapshot`（残高変動履歴から写し取った CSV 確定時点の値。LINE の月次サマリはこれを読む。#398）/ 不完全月判定 `isIncompleteMonthReport` を含む）
- Repository I/F: `TransactionRepository`, `MonthlyReportRepository`
- 値オブジェクト: `BalanceFreshness`（残高鮮度評価。`BalanceFreshnessStatus` = `ok` / `alert`、閾値の単一ソース `BALANCE_FRESHNESS_THRESHOLD_DAYS` = 35（OQ-44）、評価関数 `evaluateBalanceFreshness`。根拠の最終更新日時は残高・資産推移管理から借用し、判定は本コンテキストが持つ — 08c / 08d L244）
- Query I/F: `DashboardQuery`（KPI・カテゴリ内訳に加え、残高鮮度評価リスト `fetchBalanceFreshness` を提供。口座単位の残高情報は本人のみ可視のため `viewerId` を取り、本人所有の別銀行貯蓄口座だけを返す — P2-B5 / AT-404）, `MonthlyReportQuery`, `TransactionListQuery`
- View 型: `DashboardKpisView`, `CategoryBreakdownView`, `BalanceFreshnessListView`（+ `BalanceFreshnessItem`）, `MonthlyReportView`, `TransactionListItem`
- プライバシー: `ViewerContext`, `ViewerRole`（`applyPrivacyFilter` 関数群は内部実装、Query 実装層からのみ使用）
- ドメインイベント: `MonthlyReportCsvConfirmed`, `MonthlyReportFinalized`, `TransactionDeleted`, `TransactionManuallyClassified`（`ConfirmedClassification` を含む）, `CategoryTransactionsRemapped`（マスタ削除リマップの家計分析完了通知）

### balance-asset-tracking（残高・資産推移管理）

- 集約: `Account`（`smbc_bank` / `mitsui_sumitomo_card` / `other_savings` / `nisa`。SMBC 残高更新 `applySmbcBalanceChange`、別銀行貯蓄（シャドウ）残高の手入力更新 `applyOtherSavingsBalanceChange` / 取引由来の更新 `applyOtherSavingsMovement`（同一 `transactionId` の再適用を拒否）、引落消込の残高反映 `applyUnpaidSettlementToSmbcBalance`（同一 `settlementNoticeId` の再反映を拒否）、口座登録 `registerSmbcBankAccount` / `registerMitsuiSumitomoCardAccount`（開設済み未払金集約への参照が必要） / `registerOtherSavingsAccount` / `registerNisaAccount`（初期残高・初期累計は 0 円以上 `BALANCE_INPUT_LIMIT` 以下）、名称変更 `changeBankName` / `changeBrokerageName`、種別絞り込み `asOtherSavingsAccount` / `asNisaAccount`、残高の手動操作 `withdrawOtherSavings` / `correctOtherSavingsBalance` / `correctNisaContribution`（NISA 積立累計を実際の値へ差し替える。初期累計・基準時刻は動かさない。#458。いずれも 1 件ごとに手入力操作記録 `manualEntries` を積む。#459 / #458） / `correctInitialBalance`（旧初期残高を同時に返す） / `inactivateAccount`（別銀行貯蓄・NISA のみ） / `reactivateAccount`（非アクティブ化の取り消し。所有者本人のみ・非アクティブな口座のみ。口座種別では絞らない。解除する非アクティブ記録〔日時・理由〕を同時に返す。#457）、振込由来の加算 `addOtherSavingsBySmbcTransfer` / `addNisaContributionBySmbcTransfer`（出金用途判別からの呼び出し用。#390）、手入力金額の上限 `BALANCE_INPUT_LIMIT` を含む。共通口座属性に楽観ロックの版数 `common.version` を持ち、保存時の版数照合は `AccountRepository.save` が担う。#459）, `BankDeposit`（入金変動 + 入金用途判別結果。`salary` / `expense_reimbursement` / `other_savings_return` / `unknown`。判別結果の記録 `recordBankDeposit` / 手動確認による確定 `confirmBankDepositPurpose`（本人のみ・別用途への変更は不可。同じ用途での再確定は冪等で、反映の前方回復の入口） / 確定判定 `isDeterminedBankDeposit` / 可視判定 `canViewBankDeposit` を含む。確定経路 `DeterminationSource`（`automatic` / `manual`）を保持）, `EmployerRemitterDirectory`（勤務先振込元名簿。利用者ごとに 1 つで、入金用途判別の入口になる勤務先振込元名パターンの保管先。空の名簿 `emptyEmployerRemitterDirectory` / 確定済み入金からの登録 `registerEmployerRemitterFromDeposit`（本人のみ・給与/経費精算入金として確定した入金のみ・同名の再登録は冪等） / パターンの取り出し `employerRemitterNamesOf` / 登録済み判定 `isRegisteredEmployerRemitter` / 可視判定 `canViewEmployerRemitterDirectory` を含む。登録経路は #390 の手動確認窓口 1 本で、設定画面での手入力は作らない。#448 / OQ-61）, `MitsuiSumitomoUnpaid`（開設 `openMitsuiSumitomoUnpaid` / 未払金計上 `bookUnpaid` / 消込 `settleUnpaid` / 通知別の消込エントリ `settledEntriesForNotice` / 消込合計 `settledTotalForNotice` を含む）, `BalanceHistoryEntry`（残高変動履歴。追記のみ。口座ごとに残す。記録 `recordBalanceChange` / 軸ごとの並べ替え `balanceHistoryOfAxis` / 世帯合算の推移 `householdBalanceSeriesOfAxis`（口座ごとの直近値を持ち越して合算。`windowStart` を渡すと、期間中に動きが無い軸でも期間の開始時刻に世帯合算の補助点を置き、線が消えないようにする — `BalanceSeriesPoint.isCarriedForward` で実際の記録と区別する。#538）/ 世帯合算の最終値 `latestHouseholdValueOfAxis`（記録が無ければ null）/ 口座 1 件の推移 `accountBalanceSeriesOfAxis`（期間より前の最後の値を期間の起点に置く。期間中に動きが無い口座の線が消えないようにする。この補助点も `isCarriedForward: true`）/ 口座 1 件の残高変動履歴 `accountBalanceHistoryRows`（自動反映と手入力を混ぜ、直前の値からの増減を出す。手入力の種別・メモは発生日時の一致で添える。`AccountBalanceHistoryRowSchema` / `ManualBalanceUpdateSourceSchema` / `ManualEntryAnnotation`。どちらも口座IDで絞る。#406）を含む。#398）
- 値オブジェクト: `AccountKind`, `BalanceAxis`（`smbc_balance` / `other_savings_balance` / `nisa_contribution` / `card_unpaid`。口座種別からの導出 `balanceAxisOfAccountKind`）, `BankName`（上限 `BANK_NAME_MAX_LENGTH`）, `BrokerageName`（および `brokerageNameToDisplay`。`other` の上限 `BROKERAGE_CUSTOM_NAME_MAX_LENGTH`）, `InactivationReason`（非アクティブ理由 `InactivationReasonSchema` = 1〜100 文字。口座集約の書き込みと `AccountInactivated` / `AccountReactivated` の単一ソース）, `OtherSavingsUpdateSource`, `ManualEntryMemo`（手入力に添えるメモ `ManualEntryMemoSchema` = 200 文字以下・空白のみ不可。別銀行貯蓄と NISA の手入力記録が共用する。#459 / #458）, `OtherSavingsManualEntry`（手入力操作記録 `manual_withdrawal` / `manual_correction`。#459）, `NisaManualEntry`（NISA 積立累計の手入力操作記録 `manual_correction`。補正前後の累計を残す。#458）, `DepositPurpose` / `DeterminedDepositPurpose` / `ProvisionalHandling`, `WithdrawalPurpose` / `OtherSavingsCounterpartyNames`, `BankDepositPurposeRule`（組立 `bankDepositPurposeRule` + 既定値 `DEFAULT_SALARY_PAYOUT_DAY_WINDOW` / `DEFAULT_SALARY_THRESHOLD_AMOUNT`）, `normalizeRemitterName`
- ドメインサービス: `canListAccountInBalanceList` / `canViewAccountDetail`（口座詳細の可視範囲。所有者本人のみ。一覧と違い非アクティブの口座も見てよい — #406） / `accountDisplayName` / `acceptsBalanceManualEntry` / `SMBC_BANK_DISPLAY_NAME` / `MITSUI_SUMITOMO_CARD_DISPLAY_NAME`（口座の表示名と、残高の手入力を受け付ける口座種別。残高一覧と口座詳細が共有する — #406） / `spouseVisibleAssetTotal` / `SPOUSE_TOTAL_VISIBLE_ACCOUNT_KINDS`（残高一覧の可視範囲。一覧は本人の active 口座のみ、配偶者は別銀行貯蓄 + NISA 積立累計の合計だけ・対象口座が無ければ null — P2-B5 / AT-404 / OQ-60）, `determineBankDepositPurpose`（OQ-21 の入金日 + 金額 2 シグナル判別。矛盾時は用途不明 = 手動確認待ち） / `determineBankDepositPurposeForUser`（勤務先振込元名簿を入口にして判別する。判別ルールの組み立てを呼び出し側に持たせない。名簿が空なら別銀行戻しだけ判別し残りは用途不明。#448 / OQ-61）, `determineWithdrawalPurpose`, `applyOtherSavingsReturn` / `applyOtherSavingsTransfer`（シャドウ残高への資金移動。金額は正・向きは関数側が決める）
- Repository I/F: `AccountRepository`, `BankDepositRepository`, `EmployerRemitterDirectoryRepository`（`findByOwner` は未登録なら空の名簿を返す）, `MitsuiSumitomoUnpaidRepository`, `BalanceHistoryRepository`（追記 `append` は冪等 / 期間読み出し `findByOccurredAtRange`（上端は未満）/ 期間の起点になる (軸, 口座) ごとの直前値 `findLatestPerAccountBefore` / 口座 1 件ぶんの期間読み出し `findByAccountAxisAndOccurredAtRange` と起点 `findLatestForAccountAxisBefore`〔#406〕）
- Query I/F: `AccountBalanceQuery`（`fetchBalanceList` は `viewerId` で本人の口座に絞る。`fetchAssetTotal` は世帯フルオープンで絞らないが `viewerId` を受け取る — P2-B5 / AT-404 / OQ-60）, `BalanceTimeSeriesQuery`（読み出し元は残高変動履歴。軸ごとに世帯合算して返す。世帯フルオープンだが `viewerId` を受け取る）, `AccountDetailQuery`（口座 1 件の詳細。所有者以外には null を返し、他人の口座と存在しない口座を区別させない。#406）
- View 型: `AccountBalanceListView`（`items` は本人の口座のみ。配偶者分は別銀行貯蓄 + NISA 積立累計の合計 `spouseOtherSavingsAndNisaTotal` だけを持ち、対象の口座が無ければ null。`other_savings` は最終更新日時までを供給し、鮮度の経過日数・状態は持たない — 08d L244）, `BalanceTimeSeriesView`（`BalancePoint` は `isCarriedForward` を持ち、期間開始の補助点か実際の記録かを画面が区別できる。`AccountDetailView.series` も同じ `BalancePoint` を使う。#538）, `AssetTotalView`, `AccountDetailView`（口座 1 件の いまの値・推移・残高変動履歴。所有者以外には作られない — #406）
- ドメインイベント: `AccountBalanceUpdated`, `AccountRegistered`, `AccountInactivated`, `AccountReactivated`, `InitialBalanceRegistered`, `InitialBalanceCorrected`, `OtherSavingsBalanceUpdated`, `BankNameChanged`, `BrokerageNameChanged`, `UnpaidBookkept`, `UnpaidSettled`, `NisaContributionAdded`, `NisaContributionCorrected`（#458。加算とは別イベント。前後の累計を載せる）, `BankDepositPurposeDetermined`, `ExpenseReimbursementDepositArrived`（08e の「経費精算入金を受信する」を起動する上流トリガー。08e が発行する `ExpenseReimbursementDepositReceived` とは別物）

### auto-classification（自動分類・学習、08b）

- 集約: `MerchantLearningRule`（`active` / `disabled`、X-1: AMAZON.CO.JP 拒否。`reflectManualClassification` で手動修正を T-2 軸独立に即時反映。`applicableClassification` で学習済みルールから適用可能な分類を導出）, `BulkClassificationSession`（`in_progress` / `completed` / `aborted`。取込起因は `csv_import` / `single_correction` / `transaction_list`。`startBulkClassificationSession` で開始し、`advanceBulkClassificationSession` で分類し終えた対象を記録して残件数を減らす（再送に冪等））
- 値オブジェクト: `CategoryLearningRef` ほか T-2 独立 3 軸（`LearningRefs` 束 + `deriveLearnedRefs` / `applicableClassificationFromRefs`）, `ClassificationResult`, `AmazonMatchState`, `LearningAxis`, `ManualClassification`（UL「修正後分類」）+ `ReflectManualClassificationResult`
- Repository I/F: `MerchantLearningRuleRepository`, `BulkClassificationSessionRepository`
- Query I/F: `RetroactiveCandidateQuery`（J-3）+ `RetroactiveCandidateView`
- ドメインイベント: `TransactionAutoClassified` ほか 9 種（マスタ削除リマップの自動分類学習完了通知 `CategoryLearningRulesRemapped` / `ExpenseTypeLearningRulesRemapped` を含む）

### expense-settlement（経費精算、08e）

- 集約: `MonthlyExpenseCycle`（`accumulating` / `csv_confirmed` / `finalized`。月初リセットの生成 `startMonthlyExpenseCycle`（08e §2。手動開始・月初の自動開始の共通生成経路）、`cycleExpenseTotal` / `calculateSettlementMatchDifference` で突合差額を算出）, `ProratedChildTransaction`, `ExpenseReimbursementDeposit`（`awaiting_match` / `matched` / `unrecognized_confirmed`）
- 値オブジェクト: `ExpenseTypeAccumulation`（`capped` / `unlimited`、論点15 構造分離）, `ExpenseJudgment`, `SettlementMatchDifference`
- Repository I/F: `MonthlyExpenseCycleRepository`, `ProratedChildTransactionRepository`, `ExpenseReimbursementDepositRepository`
- Query I/F: `ExpenseSettlementManagementQuery`（本人のみ可視・論点11）+ `ExpenseSettlementManagementView`
- ドメインサービス（複数集約を協調させる純粋関数。driven port と異なり実装もドメイン内）: `finalizeExpenseSettlement` / `settleDepositForFinalizedCycle`（`MonthlyExpenseCycle` × `ExpenseReimbursementDeposit` 2集約横断の最終確定検証・終端遷移、OQ-49 / #100）, `recalculateAccumulationForCapChange`（月次上限変更時の `ExpenseTypeAccumulation` FIFO 按分再計算、#140）
- ドメインイベント: `MonthlyExpenseCycleStarted` ほか 11 種

### transaction-import（取引取込、08a）

- 集約: `TransactionCandidate`（`normal` / `amazon_matched` / `match_timeout` / `confirmed`。遷移 `matchAmazonOrder`（通常 → Amazon突合。商品名を紐付け取込ソースを `amazon_match` へ移す。メール由来以外は不変条件違反）/ `confirmMatchTimeout`（通常 → 突合タイムアウト未分類。取込ソースは元のまま）/ `confirmCandidate`、読取り `emailGmailMessageIdOf`）, `DailyMailImportBatch`（`startBatchImporting` / `resumeBatchImporting`（取込中バッチの引き継ぎ。件数は保ち取込開始日時を引き継いだ実行のものへ進める） / `updateBatchImportedCount`（取込中の進捗更新。件数は減らせない） / `completeBatch` / `failBatch`、判定 `judgeManualMailImportCooldown`（API 経由の手動実行のクールダウン。直近バッチの最終活動時刻から `MANUAL_MAIL_IMPORT_COOLDOWN_MS`（既定 10 分）未満なら受け付けない — #489。返り値は `ManualMailImportCooldownJudgment`（`acceptable` / `cooling_down` + 残り時間 + 直近バッチの状態）。日次の自動起動には掛けない））, `StatementImportJob`（`startPdfConversion` / `startFormatValidation` / `startImporting` / `updateProcessedCount` / `completeImportJob` / `failImportJob`）
- 値オブジェクト: `CandidateImportSource`, `AmazonOrderInfo`, `AmazonMailParseResult`, `AmazonMatchPending`（Amazon突合保留 = 注文ID + 受信日時 + タイムアウト期限 + 保留理由）, `SmbcMailParseResult`, `DuplicationJudgment`, `ImportResultSummary`, `ImportJobFailureReason`, `PdfConversionFailureReason`（および `normalizeMerchantName` — OQ-23 加盟店名正規化 / `isAmazonMerchantName` — 突合相手の絞り込み用の加盟店判定（記号・大小文字を落として AMAZON で始まるか）/ `statementSiteUrl` — 明細取得元サイトURL（`statementSiteMonthSupported` で対象月を URL で指定できる種別かを判別する。カードは `?p01=YYYYMM` で指定可、銀行は指定不可 — OQ-38。取込画面のガイドと CSV 取込リマインダーが同じリンク・同じ案内を出すための単一実装、#472）
- Repository I/F: `TransactionCandidateRepository`（GmailID / 三項一致検索 / `findEmailSourcedNormalCandidates`（メール由来・通常の候補を発生日の範囲で引く。Amazon 突合の相手探しと SMBC 先着タイムアウトの掃き出しに使う））, `DailyMailImportBatchRepository`（進行中バッチの引き当て `findInProgressByUser` / 直近バッチの引き当て `findLatestByUser`（状態を問わない。手動実行のクールダウン判定に使う — #489））, `StatementImportJobRepository`
- Service I/F（ACL 翻訳層の driven port、実装は adapter 層）: `PdfToCsvConverter`（OQ-23、`ConvertedStatementRow` / `PdfToCsvConversion` を含む）, `GmailMailFetchGateway`（#412、実装は api 層。取込対象期間の SMBC 通知メール / Amazon 注文確認メールをパース前の外部表現のまま取得する。`MailFetchRequest`（トークン保管参照 + 取込対象期間）/ `MailFetchResult` / `SmbcNotificationMailBody` / `AmazonOrderConfirmationMailBody` / `MailKindHint` / `MailFetchFailure` を含む。失敗は例外ではなく戻り値で返し、トークン失効 `oauth_revocation_detected` をその他の取得失敗 `other_fetch_failure` と型で区別する — 失効は再認可導線 #392 の起点）
- パース関数型（driven port ではなく純粋なドメイン処理のシグネチャ。実装もドメイン内）: `SmbcNotificationMailParser`（#414 の日次メール取込ワーカーが注入して使う。`SmbcNotificationMailParseInput`（メール本文 + ユーザーID + 検知日時）→ `SmbcMailParseResult`。例外は投げず失敗も `parse_failure` で返す。戻り値の加盟店名は NFKC 正規化済みであることが事後条件 — OQ-23）+ `parseSmbcNotificationMail`（実装 #415。実メールで確定した本文構造は 08a §2.1 が一次情報。カード利用 / 振込入金 / カード引落確定の 3 種のみパースし、実メールが観測されていない銀行出金・カード返金は語彙のみ温存）／`AmazonOrderConfirmationMailParser`（#391 の Amazon 突合が注入して使う。`AmazonOrderConfirmationMailParseInput` → `AmazonMailParseResult`）+ `parseAmazonOrderConfirmationMail`（実装 #391。`text/plain` の行構造から注文番号・注文合計・商品名を取り、注文日時にはメールの受信日時を使う — OQ-1(4)。送信元ドメインだけで絞って取得するため注文確認以外の Amazon メールも同じ袋で届き、本文に注文確認メールの目印（挨拶文）が無ければ `not_order_confirmation` を返して件数・イベントに出さない。`parse_failure` は目印はあるのに読めなかった場合だけに絞る — #624）
- 突合のドメイン関数（純粋・I/O 依存なし）: `matchAmazonOrders`（Amazon 注文とカード利用通知由来の候補を、金額の完全一致と前後 3 日で突き合わせる。注文・候補の**双方から一意に決まる組み合わせだけ**を突合し、決まらなければ `AmazonMatchPending` にする — OQ-17）/ `judgeAmazonFirstTimeout`（Amazon 先着タイムアウト。期限で注文情報を破棄する側）/ `judgeSmbcFirstTimeout`（SMBC 先着タイムアウト。「Amazon 注文不明」で未分類確定にする側）/ `amazonMatchTimeoutAt` / `AMAZON_MATCH_TIMEOUT_DAYS`（双方向 3 日）
- Query I/F: `CsvImportStatusQuery` + `CsvImportCompletionView`
- ドメインイベント: `MailImportBatchLaunched` / `CardUsageTransactionImported` / `SettlementNoticeReceived` ほか 13 種

### onboarding-auth（オンボーディング・認証、08f）

- 集約: `AppUser`（`phase1_completed` → `phase2_in_progress` → `phase2_completed` → `operation_started`、論点8 順序強制。登録 `registerAppUser` / ニックネーム変更 `changeNickname` / LINE 運用設定の事前蓄積 `recordLineFriendAdded` / `activateNotification`（世帯の `SharedTalkRoom` を受け取り 2 集約横断の不変条件を強制。+ 読取り `lineOperationSettingsOf`、運用開始発火 `startOperation` で集約直下へ昇格）/ Phase2 セクション遷移 `completeSectionA` / `completeSectionB` / `confirmSection`（C/D/E の確認。SectionB 完了が前提・確認済みの再確認は同一インスタンスを返す冪等）/ `completeSectionF` / `skipSectionF` / 配偶者完了検知 `detectSpouseCompletion`（論点19 の判定規約、Query 実装が共有）を含む）, `GmailOAuthToken`（`valid` / `revocation_detected`）, `SharedTalkRoom`（世帯レベル・シングルトンの共通トークルーム参加状態 `not_joined` / `joined`。参加記録 `recordSharedTalkRoomJoined` / 読取り `joinedTalkRoomIdOf` / 既定値 `NOT_JOINED_SHARED_TALK_ROOM`。OQ-55 ①）, `HouseholdNotificationActivation`（世帯レベル・シングルトンの通知機能有効化記録 `not_activated` / `activated`。記録 `recordHouseholdNotificationActivated`（有効化日時を上書きしない冪等）/ 述語 `isHouseholdNotificationActivated` / 既定値 `NOT_ACTIVATED_HOUSEHOLD_NOTIFICATION`。「運用開始のテストメッセージを依頼済みか」の唯一の根拠で、per-user の有効化状態からは推測しない、#447）
- 値オブジェクト: `Nickname`（≤10 文字・省略可、Phase 3.5）, `Phase2Progress`（+ セクション識別 `SectionIdentifier`（C/D/E）/ 確認セクションの進捗の読取り `sectionConfirmationOf`（返り値は `SectionConfirmationProgress`）/ 手が付いているかの述語 `isSectionConfirmed`。`SectionConfirmed` イベントと確認操作が同じ列挙を共有する）, `LineOperationSettings`（友達追加 × 通知機能有効化。共通トークルーム参加は `SharedTalkRoom` へ分離済み。有効化記録は有効化日時のみを持ち、共通トークルームID は持たない — 保持する置き場は `SharedTalkRoom` 1 か所、#334）, `RoleJudgment`（+ 役割判定 `judgeRole` / 配偶者ユーザーID導出 `resolveSpouseUserId`、許可リスト照合）, `SpouseCompletionResult`, `GmailOAuthTokenRef`, `InitialBalanceRegistrationRef`
- Repository I/F: `AppUserRepository`, `GmailOAuthTokenRepository`, `SharedTalkRoomRepository`（世帯で 1 件のため引数なしの `find()` / `save()`）, `HouseholdNotificationActivationRepository`（同じく世帯で 1 件。`save()` は有効化済みのみ受け取る）
- Service I/F（ACL 翻訳層の driven port、実装は api 層）: `GmailOAuthGateway`（OQ-7、トークン実体は Parameter Store へ保管しドメインはパスのみ受領）, `LineFriendshipGateway`（OQ-55 ③、登録完了時とセットアップ画面からの確認（#417）で友だち状態を照会し、登録前 follow の取りこぼしを拾う。結果は `LineFriendshipStatus` = `friend` / `not_friend` / `unknown`。照会失敗は例外ではなく `unknown` で返し `not_friend` と区別する）, `requiresFriendshipCheck` / `friendshipCheckOutcomeOf`（OQ-55 ②③ / #417、照会の要否と照会結果の写像。`FriendshipCheckOutcome` = `confirmed` / `not_friend` / `unavailable`（`FRIENDSHIP_CHECK_OUTCOMES` は同じ列挙のタプル））, `LineTalkRoomMembershipGateway`（OQ-55 ① / #371、join Webhook で参加を記録する前に招待されたトークルームへの在籍を照会する。結果は `LineTalkRoomMembershipStatus` = `member` / `not_member` / `unknown`。照会失敗は `unknown` で返し `not_member` と区別し、`unknown` は `retryable` で一時障害と恒久的な失敗を分ける。`LineTalkRoomKind`（`group` / `room`）・`LineTalkRoomMembershipCheck`（照会 1 回分の入力）を含む）, `decideSharedTalkRoomJoin` / `requiresTalkRoomMembershipCheck`（OQ-55 ① / #371、join Webhook 由来の参加記録の可否判定。`SharedTalkRoomJoinVerdict` = `record` / `skip` / `retry_later`）
- ドメインサービス（集約横断の判定。application 層が保存とイベント発行を行う）: `decideOperationStart`（論点16、夫婦 2 人の `AppUser` が揃って Phase2 完了なら運用開始済みへ遷移させる。`HouseholdMembers` / `OperationStartedHousehold` / `OperationStartDecision` を含む。片方のみ完了では発火しない）, `decideHouseholdNotificationActivation`（08f §2「通知機能を有効化する」。世帯が未有効化・両者運用開始済み・友達追加済み・世帯が共通トークルーム参加済みで有効化し、配信先は `SharedTalkRoom` から取る。二重発行の防止に使う「もう依頼したか」は `HouseholdNotificationActivation` を受け取って判定し、`already_activated` を返す、#447）
- Query I/F: `SpouseCompletionQuery`（論点19: 画面ロード時のみ）
- ドメインイベント: `RoleJudged`, `GmailOauthRevocationDetected`（OAuth 所有者として一元宣言）ほか 20 種

### master-data（マスタ管理、08h）

- 集約: `CategoryMaster` / `ExpenseTypeMaster`（`default` / `custom`、規定は改名・削除関数なし。名前一意性は save 前に `assertCategoryNameAvailable` / `assertExpenseTypeNameAvailable` で検査。規定の seed 投入は `seedDefaultCategory` / `seedDefaultExpenseType`、規定名の正は `DEFAULT_CATEGORY_NAMES` / `DEFAULT_EXPENSE_TYPE_NAMES`）, `MonthlyLimit`（`capped` / `unlimited`、論点15。seed 投入は `seedMonthlyLimit` + ロール別既定値 `defaultSeedLimitFor`）, `Phase0Config`（3 要素必須）
- 値オブジェクト: `OwnershipScope`（`assertVisibleTo` で所有スコープの閲覧可否を検証）, `RenameRecord`, `SeedLimit`, `DeletionRequestState`（完了通知は依頼先コンテキストの部分集合。記録は `appendCompletedRemapContext`、依頼先かの判定は `isRequestedRemapContext`）, `CategoryDeletionRequest`, `ExpenseTypeDeletionRequest`, `Allowlist`
- Repository I/F: `CategoryMasterRepository`, `ExpenseTypeMasterRepository`, `MonthlyLimitRepository`, `Phase0ConfigRepository`
- Query I/F: `AllowlistQuery`, `LineChannelConfigQuery`
- ドメインイベント: `CategorySeedInserted` ほか 17 種

### notification-delivery（通知配信、08g）

- 集約: `DeliveryMessage`（配信用途 × 配信先マトリクスを superRefine で強制。予約 `reserveDeliveryMessage` / 送信ライフサイクル遷移を含む）, `LineDeliveryLog`（不変監査レコード + 冪等性キー、OQ-34。終端状態からの組立 `createLineDeliveryLog` / 配信確定判定 `concludesDelivery`・`concludedDeliveryOf`（未達が確定した失敗は確定させず同一冪等性キーで再送信可、#441-A）/ 発生日時 `deliveryLogOccurredAt`）, `FailsafeEmail`（予約 `reserveFailsafeEmail` / 送信ライフサイクル遷移を含む）
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
