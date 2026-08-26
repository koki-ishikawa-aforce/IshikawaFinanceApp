# 割まる(わりまる)

正式名称は **わりまる**。「割りまる」は誤表記。

夫婦2人向けの家計簿・資産管理アプリ。SMBC 通知メールの自動集計を軸に「自動集計できる範囲だけ追う」が設計原則。
TypeScript 5.4 / ESM / pnpm 9 workspace モノレポ。Node >= 20。

## パッケージ構成(ヘキサゴナル)

- `packages/domain` — 純粋ドメイン層。依存は zod のみ(I/O・フレームワーク依存は禁止)。8つの境界づけられたコンテキスト + `shared`
- `packages/adapters-postgres` — Drizzle ORM + PostgreSQL(本番は Neon、ローカル開発と統合テストは素の PostgreSQL)。実装クラスは `Postgres*Repository` / `Postgres*Query` 命名
- `packages/api` — Hono。`src/composition-root.ts` で DI 合成
- `packages/web` — Next.js 15 Static Export + React 19 + LIFF

依存の向きは必ず `domain ← adapters-postgres ← api / web`。逆向きの import は規約違反。

## コマンド

- 検証一式(CI と同一順): `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check`
- 自動整形: `pnpm format`
- 統合テスト(adapters-postgres の変更、または domain の振る舞い変更がある場合。要 PostgreSQL):
  ```bash
  docker compose up -d db
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/warimaru_test \
    pnpm --filter @warimaru/adapters-postgres test:integration
  ```
- マイグレーション生成: `pnpm --filter @warimaru/adapters-postgres db:generate`(DDL の手書きは禁止。データ移行 DML の例外は「してはいけないこと」を参照)

## アーキテクチャ原則(要点)

- 集約は `aggregates/` `value-objects/` `repositories/` `queries/` `services/`（外部システムへの driven port、必要な BC のみ） `events/` のディレクトリ構成。各ディレクトリに barrel `index.ts`
- ドメイン不変条件は Zod スキーマ(`superRefine` 等)とドメイン関数に置く。adapters / api 層で再実装しない
- プライバシー3段階ルール(世帯フルオープン/個人は相手に合計のみ/経費は本人のみ): Query 実装は必ず ViewerContext を通す。Query の追加・変更時は相手ロールでの否定形テスト(見えないことの検証)を必須とする
- ドメインイベント名は過去形(例: `MonthlyExpenseCycleStarted`)

一次資料(詳細はこちらを読む。CLAUDE.md には複製しない):

- 命名規約・公開 API 一覧: `packages/domain/README.md`
- 永続化層の規約: `packages/adapters-postgres/README.md`(実装クラスの命名・`pg` の依存宣言・適用済みマイグレーションの扱い)
- ドメイン概要・設計原則: `docs/domain/01-overview.md`
- 境界づけられたコンテキスト: `docs/domain/07-bounded-contexts.md`
- ユビキタス言語: `docs/domain/08-ubiquitous-language.md`(BC 別: 08a〜08h)
- 集約定義: `docs/domain/09-aggregates.md`
- デザインガイド: `DESIGN.md` — web の見た目に関わる変更はこれに従う(トークン・アイコン・装飾・テーマ・アクセシビリティ)
- 使用性の規範: `docs/design/usability.md` — web の画面・フローに関わる変更はこれにも従う(状態の網羅・プライバシーの UI 表現・ユーザーエラー防止・入力負荷・マイクロコピー・インタラクションの一貫性・LIFF 固有・アクセシビリティ)
- レビュー観点の体系: `docs/review/README.md` — 品質特性ごとの担保手段(CI / レビュースキル / 人間)と「変更パス → 起動するレビュー」のトリガー表
- 開発ワークフローの全体像: `docs/workflow/README.md` — 工程の通し仕様・ラベルの状態遷移・実行基盤(skills / hooks / Routine)・設計原則

## 開発フロー

タスク管理は GitHub Issue 起点。全体像は `docs/workflow/README.md`、どの差分でどのレビューを回すかは `docs/review/README.md` のトリガー表に従う。

1. 要件の Issue 化: `/issue-create`
2. Issue の実装〜PR 作成: `/issue-work`
3. 検証ループ: `/verify` — コード変更を完了と報告する前に必ず全 green にする
4. DDD 観点レビュー: `/ddd-review`(PR 前に実施)— レビュー指摘は must-fix だけでなく suggestion も原則その場で修正する。見送りは例外(独立した PR が必要な別リファクタリング相当の規模、またはユーザーの意思決定が必要な設計判断)のみ。Issue 化するのは後者(設計判断)だけで、規模を理由とする見送りは PR 本文に記録して追跡する(基準の詳細は各レビュー skill の SKILL.md を正とする)
   - UI レビュー: `/ui-review`(`packages/web` 配下に変更がある場合、`/ddd-review` に加えて実施)— `DESIGN.md` とプレゼンテーション層の観点(デザイントークン規律・絵文字リグレッション・テーマ両対応・アクセシビリティ)でレビュー。指摘の扱いは `/ddd-review` と同じ
   - 使用性レビュー: `/ux-review`(`packages/web` 配下のうち画面・フローの追加変更がある場合、`/ui-review` に加えて実施)— `docs/design/usability.md` の規範(状態の網羅・プライバシーの UI 表現・ユーザーエラー防止・入力負荷・マイクロコピー・インタラクションの一貫性・LIFF 固有・アクセシビリティ)でレビュー。デザインシステム適合の5観点は `/ui-review` の担当なので重複させない。指摘の扱いは `/ddd-review` と同じ
   - テスト品質レビュー: `/test-review`(テストファイルを含む差分、または `packages/domain` の振る舞いに変更がある場合、`/ddd-review` に加えて実施)— テストが実際に振る舞いを検証しているか(実装をなぞっただけのテスト・境界値と異常系・否定形テスト・テストピラミッドの置き場所・公開 API に対して書かれているか)でレビュー。プライバシー3段階ルールの否定形テストは `/ddd-review` の担当なので重複させない。指摘の扱いは `/ddd-review` と同じ
   - セキュリティレビュー: `/security-review`(`packages/api` の routes / middleware / gmail-oauth / aws、または認証・外部連携(LINE / Gmail)に変更がある場合、`/ddd-review` に加えて実施)— 外周の攻撃面(Webhook 署名検証・ID トークン検証・認可の位置・シークレット/PII のログ流出・外部入力の検証)でレビュー。プライバシー3段階ルールは `/ddd-review` の担当なので重複させない。指摘の扱いは `/ddd-review` と同じ
   - データレビュー: `/data-review`(`packages/adapters-postgres`(マイグレーション / スキーマ / Query)、またはドメインイベントとそのハンドラに変更がある場合、`/ddd-review` に加えて実施)— 既存データとデプロイに対する安全性(破壊的スキーマ変更・デプロイ順序・索引欠落と N+1・トランザクション境界・イベントハンドラの冪等性)でレビュー。マイグレーションの構文と適用可能性は CI が担保するので重複させない。指摘の扱いは `/ddd-review` と同じ
   - 信頼性・可観測性レビュー: `/reliability-review`(ドメインイベント・イベントハンドラー・通知配信・外部 API 呼び出しに変更がある場合、`/ddd-review` に加えて実施)— 外部呼び出しの失敗時挙動・失敗の握りつぶし・イベント再実行の回復性・障害に気づけるかの観点でレビュー。冪等性のうち「データに二重適用が残らないか」はデータレビューの担当なので重複させない。指摘の扱いは `/ddd-review` と同じ
5. 判断待ちの消化: `/decide` — 各スキルが `needs-decision` に集約した判断依頼を対話で消化し、決定を Issue と docs(ドメインは `docs/domain/03-open-questions.md`、ワークフローの原則は `docs/workflow/04-principles.md`)に反映する
6. 無人運用の振り返り: `/retro` — 無人モード(`/issue-work`・`/pr-steward`)の失敗データを週次で振り返り、繰り返す失敗パターンとワークフロー全体の点検から skills / CLAUDE.md / Issue テンプレート / `docs/workflow`(原則)の改善案を `needs-decision` Issue として起票する(読み取り専用。判断は `/decide`)

ブランチ名は `feat/issue-<番号>-<slug>`、PR 本文に `Closes #<番号>` を含める。
着手中の Issue には `status:in-progress` ラベルを付与する(`/issue-work` が自動で行う)。

バックログの無人消化: `ready-to-implement` ラベル付き Issue は Routine が2時間おきに `/issue-work` を無人モードで起動し、1 fire 1件ずつ実装 → PR → CI green → **マージ**まで進める。ready 化は `/issue-create` が作成時に判定するほか、`/backlog-ready` でまとめて行える(設計判断が残存する Issue には `needs-decision` を付けて `/decide` に接続する)。無人モードはユーザー確認の代わりに撤退を選び、溜まった `needs-decision` は `/decide` でまとめて消化する。

**人間の承認ゲートは `ready-to-implement` の付与(着手承認)1点**。マージ可否は機械的な**マージゲート**(CI green・コンフリクトなし・`needs-decision` なし等をコマンド出力で確定)で判定し、満たせば無人モードがマージする。ゲートの定義は `.claude/skills/issue-work/SKILL.md`「マージゲート」の1箇所のみ。個別 PR の自動マージを止めたいときは、その PR に `needs-decision` を付ける。

PR の保守(CI 修復・コンフリクト解消・重複検知): `/pr-steward` が Routine 起点の open PR を巡回して green に戻す(マージはしない。green にした PR は次のバックログ fire の回収マージが拾う)。

無人運用の全体像 — Routine 4本(バックログ / PR 執事 / 振り返り / 乖離検知)、ラベルの状態遷移、hooks による実行時ガード、PR プレビュー配信、設計原則 — は `docs/workflow/README.md` を参照。各運用のセットアップと止め方は `docs/automation/` にある。

## してはいけないこと

- `packages/domain` に I/O・フレームワーク依存を追加しない(zod のみ)
- ドメイン不変条件を adapters / api 層で再実装しない(superRefine に置く)
- migration のテーブル定義(DDL)を手書きしない(`db:generate` の生成物のみ。生成された DDL は改変しない)
  - 例外: 既存データの移し替え(DML)は `db:generate` が生成できないため、**生成されたマイグレーションファイルの末尾に手書きで追記してよい**
  - 手書き部を追記するときは `packages/adapters-postgres/drizzle/0008_reflective_jazinda.sql` の形式を踏襲する(冒頭コメントで「どこまでが生成物・どこからが手書き」の境界と、手書きが必要な理由を明記する)
  - 手書き禁止の狙いは「コード上の定義と DB 実体のずれ防止」であり、生成物の DDL を無改変のまま残せばこの狙いは損なわれない
- main へ直接 push しない(必ず PR 経由)
- `*.module.css` に色・余白・角丸・フォントサイズの直値を書かない(デザイントークン `var(--*)` を参照する。定義元は `packages/web/src/app/globals.css`)
