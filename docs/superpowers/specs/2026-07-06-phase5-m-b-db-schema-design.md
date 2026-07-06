# Phase 5 M-B DB スキーマ設計 spec — Neon (PostgreSQL) テーブル設計とマイグレーション方式

> 作成: 2026-07-06
> 親ロードマップ: [2026-07-06-forward-roadmap.md §2 M-B](../plans/2026-07-06-forward-roadmap.md)
> 親 spec: [Phase 4 戦術的設計](./2026-05-01-phase4-tactical-design.md) §13.1–13.2
> 関連 DDD docs: [09-aggregates.md](../../domain/09-aggregates.md), [03-open-questions.md](../../domain/03-open-questions.md) §B
> 前提: Phase 5 M-A 完了（全 8 コンテキスト型化済み、Repository I/F 23 種 / Query I/F 11 種）。
> スタックは OQ-27/OQ-46 で確定済み: Hono on Lambda + **Neon Free Tier (PostgreSQL)**

---

## §1. 目的とスコープ

### §1.1 目的

`@warimaru/domain` の Repository / Query I/F を Neon (PostgreSQL) で実装するための
テーブル設計・マイグレーション方式・接続方式・テスト戦略を確定する。
あわせて M-B で確定予定の OQ-41（ID 生成方式）/ OQ-42（イベント永続化）/
OQ-43（トランザクション境界）に回答する。

### §1.2 スコープ

**In scope:**

- 集約 → テーブルのマッピング方式（全集約共通のパターン確定）
- 全 21 集約 + 補助 2 テーブル（計 23 本）のマッピングカタログ（テーブル名 / PK / 昇格カラム / 一意制約）
- 第 1 波（家計分析 + 残高資産推移管理 = 4 Repository / 5 Query）の詳細 DDL
- マイグレーション方式の選定
- ID 生成方式の確定（OQ-41）
- イベント永続化の要否判断（OQ-42）と save のトランザクション境界（OQ-43）
- 統合テスト戦略（Phase 5 DoD「Neon (PostgreSQL) で Repository/Query の統合テストが green」に対応）

**Out of scope:**

- `packages/adapters-neon/` の実装そのもの（本 spec 確定後の実装 plan で分割）
- 第 2 波以降（残り 6 コンテキスト）の詳細 DDL — §5 のカタログとパターンに従い実装時に確定
- デプロイ IaC（OQ-28、Phase 6）
- LINE 配信ログの保持期間ポリシー（OQ-34、実装フェーズ論点として §5 に注記のみ）

### §1.3 達成状態

1. 本 spec のレビュー確定をもって OQ-41 / OQ-42 / OQ-43 を 03-open-questions.md §B で解決済みに更新できる
2. 実装 plan（M-B）が本 spec の §4–§7 を参照するだけで着手できる
3. 第 1 波 DDL が `@warimaru/domain` の既存型・不変条件と 1:1 で突合できる

---

## §2. 設計方針 — 6 つの起点質問の確定回答

### §2.1 集約 → テーブル: 「集約 1 行 + JSONB payload + 昇格カラム」ハイブリッド

**決定**: 集約ルート 1 インスタンス = 1 行。行の構成は次の 3 種類のカラムからなる。

1. **PK カラム**: branded ID（または自然キー）をそのまま text 型で保持
2. **昇格カラム（promoted columns）**: 検索条件・一意制約・集計・状態判定に使うフィールドだけを
   個別カラムに昇格（`kind` は discriminated union を持つ全集約で必ず昇格し CHECK 制約を張る）
3. **`payload jsonb`**: 集約全体のシリアライズ結果。**復元の唯一の正**であり、
   読み出しは常に `payload` → `XxxSchema.parse()` で行う（superRefine 不変条件が
   DB 由来データにも毎回適用される）

昇格カラムは save 時に adapter が parse 済み集約から導出する派生値であり、
書き込み経路を Repository.save に一本化することで payload との整合を保つ。

**棄却した代替案:**

| 案 | 棄却理由 |
|---|---|
| 完全正規化（ネスト VO を全て子テーブル化） | discriminated union 17 種 × ネスト構造でテーブル数と JOIN が爆発。集約単位の読み書きしかしない Repository パターンに対し過剰 |
| 完全 JSONB（昇格カラムなし） | `findByUserAndMonth` 等の検索が JSONB 式インデックス頼みになり、一意制約（§2.2)が宣言的に張れない |
| ORM リレーションマッピング | 集約の形は Zod が既に定義済み。二重にスキーマ定義を持つと乖離リスク |

**付随決定:**

- 単一 `public` スキーマを使用（コンテキスト別 PostgreSQL スキーマは分けない。
  テーブル名は全コンテキストで衝突しないため接頭辞も不要。2 ユーザー規模で運用簡素を優先）
- FK 制約は**同一コンテキスト内のみ**許可（例: `mitsui_sumitomo_unpaids.account_id` → `accounts`）。
  コンテキストをまたぐ参照（例: `transactions.category_id` → master-data）は
  09-aggregates.md §2 の「外部参照は ID のみ」に従い FK を張らず、整合はドメインイベント +
  アプリケーション層で担保する
- 全テーブルに DB 管理用の `created_at` / `updated_at`（timestamptz、adapter が設定）を持つ。
  ドメイン型には現れない
- 楽観ロック（version カラム）は**見送り**。書き込み主体は夫婦 2 ユーザー + 日次バッチであり、
  競合頻度が正当化しない。必要になった時点で `updated_at` 比較で導入できる

### §2.2 一意性・重複防止: DB unique index を真の保証とする

M-A の Repository JSDoc は「save 前の findByX で保証（Phase 5 M-B）」としていたが、
find→save 間の TOCTOU（check-then-act 競合）があるため、
**一意性の最終保証は DB の unique index** とする。find-before-save は
ユーザー向けエラーメッセージのための事前チェックに格下げする
（unique violation は adapter が `InvariantViolationError` へ翻訳して throw）。

宣言する unique index の全量は §5 カタログに記載。代表例:

| 不変条件（出典） | unique index |
|---|---|
| userId + targetYearMonth で一意（MonthlyExpenseCycleRepository） | `(user_id, target_year_month)` |
| userId + 口座種別で一意（Account 集約。集約境界をまたぐため Phase 4 spec §6.3 で保留していた項目） | `accounts (owner_user_id, kind)` |
| 進行中セッションの二重起動防止（BulkClassificationSessionRepository） | partial unique `(user_id) WHERE kind = 'in_progress'` |
| 冪等性キーで再送信重複防止（LineDeliveryLogRepository / OQ-34） | `(idempotency_key)` |
| 名前一意性（同一スコープ内、CategoryMasterRepository） | `(name, owner_user_id) NULLS NOT DISTINCT` |

### §2.3 ID 生成方式: ULID を採用（OQ-41 確定）

**決定**: 内部発番 ID は **ULID**（26 文字 Crockford Base32、時系列ソート可能）。
生成は adapter 層（`ulid` npm パッケージ）で行い、ドメイン層は生成済み文字列を受け取るのみ。
DB カラム型は `text`（PK）。UUID v7 は PostgreSQL ネイティブ型の利点があるが、
branded ID が `z.string()` ベースであること・時系列ソートの可読性から ULID とする。

ただし `shared/ids.ts` の 30 種の branded ID は**内部発番と外部由来に二分**され、
正規表現強化は内部発番のみに適用する:

| 分類 | 対象 ID | idSchema |
|---|---|---|
| 内部発番（ULID） | TransactionId, AccountId, MonthlyReportId, MitsuiSumitomoUnpaidId, UnpaidEntryId, ExpenseReimbursementId, TransactionCandidateId, ImportBatchId, ImportJobId, UploadFileId, PdfConversionJobId, BulkClassificationSessionId, MonthlyExpenseCycleId, ChildTransactionId, ExpenseTypeAccumulationId, MonthlyLimitId, CategoryDeletionRequestId, ExpenseTypeDeletionRequestId, Phase0ConfigId, DeliveryMessageId, DeliveryLogId, FailsafeEmailId, CategoryId, ExpenseTypeId | `z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)`（先頭桁 0–7 制限で 128bit 範囲外の文字列を排除） |
| 外部由来（形式は発行元依存） | UserId（= LINE userID、OQ-15）, TalkRoomId, LineMessageId, GmailMessageId, AmazonOrderId, SettlementNoticeId | `z.string().min(1)` を維持 |

外部由来 ID に発行元形式の regex（例: LINE userID = `^U[0-9a-f]{32}$`）を張るかは
実データ確認後に判断する（過剰に厳しくすると取込が止まるリスクの方が大きい）。

**注意**: 正規表現強化はテストフィクスチャ（`'tx_001' as never` 等）を一斉に壊すため、
adapters 実装と同一 PR ではなく**独立コミットで先行**させる（実装 plan で順序を明記）。

### §2.4 マイグレーション方式: Drizzle ORM + drizzle-kit

**決定**: `packages/adapters-neon/` に **Drizzle ORM** でテーブル定義（TS）を書き、
**drizzle-kit generate** で SQL マイグレーションファイルを生成・コミットする。
適用は `drizzle-kit migrate`（ローカル/CI から Neon へ）。

| 候補 | 判定 | 理由 |
|---|---|---|
| **Drizzle ORM + drizzle-kit** | **Yes** | TS ファースト（Zod 文化と整合）、`@neondatabase/serverless` ドライバをネイティブサポート、生成物が素の SQL でレビュー可能、ランタイムが軽量（Lambda コールドスタートに有利）、Query 側の集計 SQL もクエリビルダで型安全に書ける |
| Prisma | No | Lambda でのエンジンバイナリ/コールドスタートの重さ、スキーマ定義の二重管理（.prisma と Zod）が §2.1 の方針と衝突 |
| node-pg-migrate / 素 SQL | No（次点） | 最小依存だが、テーブル定義の型が TS に現れず Query 実装の型安全が手作業になる。Drizzle が過剰と判明した場合の撤退先として温存 |

マイグレーションファイルは `packages/adapters-neon/drizzle/` にコミットし、
適用履歴は Drizzle 標準の `__drizzle_migrations` テーブルで管理する。

### §2.5 接続方式とトランザクション境界（OQ-43 確定）

**決定**:

- ドライバは `@neondatabase/serverless`。単発クエリは HTTP、
  **トランザクションを要する save は WebSocket `Pool`** を使う
  （Neon の HTTP ドライバは interactive transaction 非対応のため）
- **Repository.save 1 回 = 1 トランザクション**（集約 1 つの書き込み単位 = 整合性境界。
  DDD の原則どおり）
- 集約をまたぐ更新（例: 取引修正 → 未払金更新、月次上限変更 → 按分再計算）は
  アプリケーション層で**順次保存 + in-process ドメインイベントによる結果整合**とする。
  Saga / outbox は導入しない。途中失敗は次回バッチ・次回操作での再計算で自己修復する設計を
  各ハンドラに義務付ける（冪等なイベントハンドラ）
- LineDeliveryLog の save は INSERT のみ（append-only、UPDATE 経路を adapter に実装しない）

### §2.6 イベント永続化: 行わない（OQ-42 確定）

**決定**: ドメインイベント（M-A で型定義した 89 種）は **in-process pub/sub のみ**で流し、
DB へは永続化しない。

- 根拠: 家計内 2 ユーザー規模でリプレイ要件・外部購読者が存在しない。
  監査が必要な領域は集約側で監査レコードとして既にモデル化済み
  （LINE配信ログ = 不変監査レコード、取引の削除済み状態、按分子取引の履歴等）
- イベントバスは `packages/adapters-neon/` ではなく application 層（M-B 後半）の
  同期 pub/sub 実装とし、ハンドラ失敗はログ + 前述の自己修復で吸収する
- 将来、外部連携やリプレイ要件が出た場合は outbox テーブル 1 本の追加で
  §2.5 のトランザクション内に相乗りできる（設計上の撤退線）

---

## §3. 型マッピング規約

| ドメイン型 | PostgreSQL 型 | 備考 |
|---|---|---|
| branded ID（内部発番/外部由来とも） | `text` | PK/FK。ULID でも `char(26)` にはしない（外部由来 ID と規約統一） |
| `Money`（`z.number().int().finite()`、円） | `integer` | ±21 億円で家計用途に十分。負値あり（返金・調整） |
| `YearMonth`（`'YYYY-MM'`） | `text` + `CHECK (col ~ '^\d{4}-(0[1-9]|1[0-2])$')` | ドメイン表現をそのまま保持（月初 date への変換はしない） |
| `Date` | `timestamptz` | JST 変換は表示層。DB は常に UTC |
| enum（`z.enum`） | `text` + `CHECK (col IN (...))` | PostgreSQL ネイティブ enum は値追加のマイグレーションが煩雑なため使わない |
| discriminated union の `kind` | `text` + `CHECK` | 全集約で必ず昇格（§2.1） |
| ネスト VO / 配列 / union ペイロード | `jsonb`（`payload` に内包） | 個別カラム化は §5 の昇格カラムに限る |
| `Date` の JSONB 内表現 | ISO 8601 文字列 | adapter の serialize/deserialize で `z.coerce.date()` 相当の変換を挟む（parse 前に revive） |

命名: テーブル = snake_case 複数形、カラム = snake_case。
ドメインのフィールド名と機械的に対応させる（`ownerUserId` → `owner_user_id`）。

**月境界の規約**: `YearMonth` による月絞り込み（`findByMonth` /
`TransactionListQuery.fetch` の month 等）は **JST の暦月**を意味する。
`occurred_at` 等の timestamptz カラムを月でバケットする際、adapter は `YearMonth` を
JST オフセットを織り込んだ UTC の半開区間へ変換して WHERE 句を組む
（例: `'2026-07'` → `[2026-06-30T15:00:00Z, 2026-07-31T15:00:00Z)`）。
素の UTC 月範囲（`>= '2026-07-01T00:00Z'`）で絞ると JST の毎月 1 日 00:00–08:59 の
取引が前月に混入するため**禁止**。「JST 変換は表示層」の原則は表示フォーマットの話であり、
月バケットの境界計算はこの規約に従う。

---

## §4. 第 1 波 詳細 DDL — 家計分析 + 残高資産推移管理

対象 = ロードマップ M-B の「まず 4 Repository / 5 Query」:
`TransactionRepository` / `MonthlyReportRepository` / `AccountRepository` / `MitsuiSumitomoUnpaidRepository`、
`DashboardQuery` / `MonthlyReportQuery` / `TransactionListQuery` / `AccountBalanceQuery` / `BalanceTimeSeriesQuery`。

### §4.1 transactions（集約 #7 取引）

```sql
CREATE TABLE transactions (
  transaction_id  text PRIMARY KEY,
  owner_user_id   text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('unclassified', 'classified', 'deleted')),
  merchant_name   text NOT NULL,
  amount          integer NOT NULL,
  occurred_at     timestamptz NOT NULL,
  -- classified のときのみ非 NULL（DashboardQuery / TransactionListQuery の集計・絞り込み用昇格）
  category_id     text,
  expense_class   text CHECK (expense_class IN ('household', 'personal_honey', 'personal_darling', 'business_expense')),
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(category_id, expense_class) IN (0, 2)),
  CHECK ((kind = 'classified') = (num_nonnulls(category_id, expense_class) = 2))
);

-- findByMonth(ownerId, month) / TransactionListQuery.fetch(month 絞り込み)
CREATE INDEX idx_transactions_owner_occurred ON transactions (owner_user_id, occurred_at);
-- fetchUnclassifiedSummary / isUnclassifiedOnly
CREATE INDEX idx_transactions_unclassified ON transactions (owner_user_id, occurred_at)
  WHERE kind = 'unclassified';
```

- 昇格カラムの片方だけが残る中途半端な状態（例: deleted 行に `expense_class` だけ残存）は
  2 本目の CHECK を単純比較で書くと素通りするため、`num_nonnulls` で「両方 or どちらも NULL」を
  先に強制している（§2.2「DB 制約を真の保証とする」の方針どおり）
- `findByMonth` / month 絞り込みの WHERE 句は §3 の**月境界の規約**に従い、
  JST 暦月を UTC 半開区間に変換して組む
- Dashboard の KPI・カテゴリ内訳は昇格カラム（`expense_class` / `category_id` / `amount`）の
  GROUP BY だけで完結し、payload を読まない
- プライバシー 3 段階は SQL では表現しない。Query adapter は行を取得後、
  `household-analysis/privacy/applyPrivacyFilter` モジュールのヘルパ
  （`isVisibleAsDetail` / `isVisibleAsAggregate` / `toListItems` — ドメインの唯一の
  プライバシー判定ポイント）へ通してから View を組み立てる。
  同モジュールは現在 barrel 非公開（内部実装扱い）のため、M-B で `@warimaru/domain` の
  公開 API へ昇格する（§2.3 の regex 強化と同様、adapters 実装に先行する独立コミット）

### §4.2 monthly_reports（集約 #8 月次レポート）

```sql
CREATE TABLE monthly_reports (
  monthly_report_id  text PRIMARY KEY,
  target_year_month  text NOT NULL UNIQUE CHECK (target_year_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  kind               text NOT NULL CHECK (kind IN ('csv_confirmed', 'finalized')),
  payload            jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
```

- `findByMonth(month)` が単一を返す前提（世帯で月 1 レポート）を `UNIQUE` で保証
- `BalanceTimeSeriesQuery.fetch(from, to)` は本テーブルの payload 内
  `common.balanceTrend`（4 軸時系列）を月範囲で読み出して合成する。
  専用の残高履歴テーブルは**設けない**（残高スナップショットの正は月次レポートに凍結済み、
  という M-A までのモデルを踏襲）

### §4.3 accounts（集約 #9 口座）

```sql
CREATE TABLE accounts (
  account_id     text PRIMARY KEY,
  owner_user_id  text NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('smbc_bank', 'mitsui_sumitomo_card', 'other_savings', 'nisa')),
  is_active      boolean NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- Phase 4 spec §6.3 で保留していた集約横断の一意性を DB が最終保証（§2.2）
  UNIQUE (owner_user_id, kind)
);
```

- `AccountBalanceQuery` は世帯共有（viewerId なし）のため全行を読み、
  payload から残高/積立を取り出して View を組む（口座数は一桁で全走査に問題なし）

### §4.4 mitsui_sumitomo_unpaids（集約 #10 三井住友カード未払金）

```sql
CREATE TABLE mitsui_sumitomo_unpaids (
  unpaid_aggregate_id        text PRIMARY KEY,
  account_id                 text NOT NULL UNIQUE REFERENCES accounts (account_id),
  current_month_unpaid_total integer NOT NULL,
  payload                    jsonb NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
```

- `entries`（計上中/消込済みの UnpaidEntry 配列）は payload 内に保持。
  「Σ 計上中エントリ = 当月未払金合計」は読み出し時の `MitsuiSumitomoUnpaidSchema.parse` の
  superRefine が毎回検査する（§2.1 の方針の具体例）
- 消込の冪等性（同一 settlementNoticeId の重複適用禁止）は application service が
  parse 済み集約の entries を見て担保する（M-A の JSDoc どおり）

---

## §5. 全集約マッピングカタログ（第 2 波以降の設計固定）

第 1 波（§4）以外は本カタログを正とし、実装時に §2–§3 のパターンで DDL 化する。

| テーブル | 集約 (#) | PK | 主な昇格カラム | unique / 特記 |
|---|---|---|---|---|
| transaction_candidates | 取引候補 (#1) | transaction_candidate_id | user_id, kind, merchant_name, amount, occurred_on, gmail_message_id | partial unique `(gmail_message_id) WHERE gmail_message_id IS NOT NULL`（メール重複除外）; index `(user_id, occurred_on, amount, merchant_name)`（三項一致 findByTripleMatch、OQ-7 / OQ-23） |
| daily_mail_import_batches | 日次メール取込バッチ (#2) | import_batch_id | user_id, kind | partial unique `(user_id) WHERE kind = 'in_progress'`（二重起動防止） |
| statement_import_jobs | 明細取込ジョブ (#3) | import_job_id | uploader_user_id, target_month, kind | index `(uploader_user_id, target_month)` |
| merchant_learning_rules | 加盟店学習ルール (#4) | **(user_id, merchant_name)** 自然キー | kind | F-1: 全検索が user_id 起点（配偶者データ遮断は WHERE 句で構造化） |
| amazon_product_key_learning_rules | Amazon商品キー学習ルール (#5) | **(user_id, amazon_product_key)** 自然キー | kind | 同上 |
| bulk_classification_sessions | 一括分類セッション (#6) | bulk_classification_session_id | user_id, kind | partial unique `(user_id) WHERE kind = 'in_progress'` |
| transactions | 取引 (#7) | transaction_id | §4.1 | §4.1 |
| monthly_reports | 月次レポート (#8) | monthly_report_id | §4.2 | §4.2 |
| accounts | 口座 (#9) | account_id | §4.3 | §4.3 |
| mitsui_sumitomo_unpaids | 未払金 (#10) | unpaid_aggregate_id | §4.4 | §4.4 |
| monthly_expense_cycles | 月次経費サイクル (#11) | monthly_expense_cycle_id | user_id, target_year_month, kind | unique `(user_id, target_year_month)` |
| prorated_child_transactions | 按分子取引 (#12) | child_transaction_id | parent_transaction_id, user_id | index `(parent_transaction_id)` |
| expense_reimbursement_deposits | 経費精算入金 (#13) | expense_reimbursement_id | user_id, kind | partial index `(user_id) WHERE kind = 'awaiting'`（findAwaitingByUser） |
| app_users | アプリユーザー (#14) | user_id（= LINE userID、外部由来） | role, kind | unique `(role)`（honey/darling 各 1 名、findByRole が単一を返す前提を保証） |
| gmail_oauth_tokens | Gmail OAuth トークン (#14 から M-A で集約として分離) | user_id | kind | 実トークンは Parameter Store（集約はパスのみ保持、OQ-27） |
| delivery_messages | 配信メッセージ (#15) | delivery_message_id | kind, purpose | — |
| line_delivery_logs | LINE配信ログ (#16) | delivery_log_id | idempotency_key, timing_kind | unique `(idempotency_key)`; **append-only**（adapter は INSERT のみ実装）。保持期間は OQ-34（実装フェーズ） |
| failsafe_emails | フェイルセーフメール (#17) | failsafe_email_id | kind | — |
| consecutive_failure_counters | 連続失敗カウンタ (#17 の補助 VO、M-A で独立 Repository 化) | **(ref_kind, ref_id)** 複合 PK | — | FailureCounterRef（user / talk_room）を 2 カラムに展開 |
| category_masters | カテゴリマスタ (#18) | category_id | kind, name, owner_user_id (nullable) | unique `(name, owner_user_id) NULLS NOT DISTINCT`（スコープ内名前一意、規定=世帯共有は owner NULL） |
| expense_type_masters | 経費種別マスタ (#19) | expense_type_id | kind, name, owner_user_id (nullable) | 同上 |
| monthly_limits | 月次上限 (#20) | monthly_limit_id | user_id, expense_type_id, kind, cap_amount (nullable) | unique `(user_id, expense_type_id)`; `CHECK ((kind = 'unlimited') = (cap_amount IS NULL))` — **論点15: マジックナンバー不使用を DB でも構造表現** |
| phase0_configs | Phase0設定値 (#21) | phase0_config_id | — | シングルトン: `singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton)` |

（削除リクエスト 2 種は M-A どおり VO でありテーブルを持たない。
09-aggregates.md の 21 集約に対応する 21 本 + M-A で独立させた
gmail_oauth_tokens / consecutive_failure_counters の 2 本で、**計 23 テーブル**）

---

## §6. パッケージ構成とテスト戦略

### §6.1 packages/adapters-neon/

```
packages/adapters-neon/
├── drizzle/                  # drizzle-kit generate の SQL マイグレーション（コミット対象）
├── src/
│   ├── schema/               # Drizzle テーブル定義（§4–§5 の DDL に対応）
│   ├── client.ts             # @neondatabase/serverless の HTTP / Pool 接続ファクトリ
│   ├── serialize.ts          # 集約 ⇔ payload jsonb の変換（Date revive を含む、§3）
│   ├── household-analysis/   # 2 Repository（Transaction / MonthlyReport）+ 3 Query 実装
│   └── balance-asset-tracking/  # 2 Repository（Account / MitsuiSumitomoUnpaid）+ 2 Query 実装
└── tests/                    # 統合テスト（実 PostgreSQL に接続）
```

依存方向は `adapters-neon → domain` の一方向のみ（domain は adapter を知らない）。

### §6.2 統合テスト

- **CI**: GitHub Actions の `services: postgres:16` コンテナに対して vitest の統合テストを実行
  （Neon は PostgreSQL 互換であり、本プロジェクトは Neon 固有機能を使わないため
  素の PostgreSQL で等価に検証できる）。既存 ci.yml の verify ジョブに
  `pnpm --filter @warimaru/adapters-neon test:integration` を追加
- **ローカル**: `docker compose up db`（postgres:16）+ 同一テストを実行
- **実 Neon への疎通**: マイグレーション適用と smoke テストを手動実行
  （Free Tier の接続情報はローカル `.env` のみ。CI には持ち込まない）
- テスト内容の柱: (1) save → findById → parse の往復同一性（全 kind 変種）、
  (2) §2.2 の unique index が競合時に `InvariantViolationError` へ翻訳されること、
  (3) Query が privacy フィルタ / `canViewExpenseSettlement` を通すこと（論点11 の
  PermissionDeniedError パスを含む）、(4) LineDeliveryLog の append-only

---

## §7. OQ の確定内容まとめ

| OQ | 確定内容 | 反映先 |
|---|---|---|
| OQ-41 | ULID 採用。内部発番 24 種は regex 強化、外部由来 6 種は `min(1)` 維持（§2.3） | `shared/ids.ts`（独立コミット）、03-open-questions.md §B |
| OQ-42 | イベント永続化は行わない。in-process pub/sub + 集約側監査レコードで足りる（§2.6） | 03-open-questions.md §B |
| OQ-43 | save 1 回 = 1 トランザクション。集約横断は順次保存 + 冪等イベントハンドラの結果整合。Saga/outbox 見送り（§2.5） | 03-open-questions.md §B |

OQ-38（SMBC URL）/ OQ-39（Flex Message サイズ）/ OQ-44（鮮度閾値 30 日仮置き）は
本 spec のスコープ外（DB 設計に影響しない）。M-B 期間中に別途クローズする。

---

## §8. M-B DoD（本 spec 分）

以下すべてが green であること:

- [x] D-1: 本 spec がレビュー確定し、03-open-questions.md §B の OQ-41/42/43 が解決済みに更新されている
- [ ] D-2: `packages/adapters-neon/` が §6.1 の構成で作成され、drizzle マイグレーションで §4 の 4 テーブルが生成できる
- [ ] D-3: 第 1 波 4 Repository / 5 Query の実装が完了し、§6.2 の統合テストが CI で green
- [x] D-4: `shared/ids.ts` の内部発番 ID が ULID regex に強化され、domain のテストが green
- [ ] D-5: ルートの `pnpm build / typecheck / test / lint / format:check` が adapters-neon を含めて green

---

## §9. 変更履歴

| 日付 | 版 | 内容 |
|---|---|---|
| 2026-07-06 | v0.1 | 初版（M-B 着手時の設計確定: マッピング方式 / テーブルカタログ / 第 1 波 DDL / Drizzle 採用 / OQ-41・42・43 確定） |
| 2026-07-06 | v0.2 | レビュー反映: 月境界の JST 規約を §3 に明文化 / privacy ヘルパの公開 API 昇格を §4.1 に明記 / transactions CHECK を num_nonnulls で強化 / テーブル数を 23 に訂正 / §5 の集約番号整理（gmail_oauth_tokens = #14 分離、連続失敗カウンタ = #17 補助） / branded ID 30 種・イベント 89 種に訂正 / ULID regex 先頭桁 0–7 制限 / 三項一致の出典に OQ-7 追記 / §6.1 の Repository 配置注記 |
