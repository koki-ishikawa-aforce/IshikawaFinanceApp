# 割まる(わりまる)

正式名称は **わりまる**。「割りまる」は誤表記。

夫婦2人向けの家計簿・資産管理アプリ。SMBC 通知メールの自動集計を軸に「自動集計できる範囲だけ追う」が設計原則。
TypeScript 5.4 / ESM / pnpm 9 workspace モノレポ。Node >= 20。

## パッケージ構成(ヘキサゴナル)

- `packages/domain` — 純粋ドメイン層。依存は zod のみ(I/O・フレームワーク依存は禁止)。8つの境界づけられたコンテキスト + `shared`
- `packages/adapters-neon` — Drizzle ORM + Neon。実装クラスは `Neon*Repository` / `Neon*Query` 命名
- `packages/api` — Hono。`src/composition-root.ts` で DI 合成
- `packages/web` — Next.js 15 Static Export + React 19 + LIFF

依存の向きは必ず `domain ← adapters-neon ← api / web`。逆向きの import は規約違反。

## コマンド

- 検証一式(CI と同一順): `pnpm build && pnpm typecheck && pnpm test && pnpm lint && pnpm format:check`
- 自動整形: `pnpm format`
- 統合テスト(adapters-neon 変更時のみ、要 PostgreSQL):
  ```bash
  docker compose up -d db
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/warimaru_test \
    pnpm --filter @warimaru/adapters-neon test:integration
  ```
- マイグレーション生成: `pnpm --filter @warimaru/adapters-neon db:generate`(SQL の手書きは禁止)

## アーキテクチャ原則(要点)

- 集約は `aggregates/` `value-objects/` `repositories/` `queries/` `services/`（外部システムへの driven port、必要な BC のみ） `events/` のディレクトリ構成。各ディレクトリに barrel `index.ts`
- ドメイン不変条件は Zod スキーマ(`superRefine` 等)とドメイン関数に置く。adapters / api 層で再実装しない
- プライバシー3段階ルール(世帯フルオープン/個人は相手に合計のみ/経費は本人のみ): Query 実装は必ず ViewerContext を通す
- ドメインイベント名は過去形(例: `MonthlyExpenseCycleStarted`)

一次資料(詳細はこちらを読む。CLAUDE.md には複製しない):

- 命名規約・公開 API 一覧: `packages/domain/README.md`
- ドメイン概要・設計原則: `docs/domain/01-overview.md`
- 境界づけられたコンテキスト: `docs/domain/07-bounded-contexts.md`
- ユビキタス言語: `docs/domain/08-ubiquitous-language.md`(BC 別: 08a〜08h)
- 集約定義: `docs/domain/09-aggregates.md`

## 開発フロー

タスク管理は GitHub Issue 起点。

1. 要件の Issue 化: `/issue-create`
2. Issue の実装〜PR 作成: `/issue-work`
3. 検証ループ: `/verify` — コード変更を完了と報告する前に必ず全 green にする
4. DDD 観点レビュー: `/ddd-review`(PR 前に実施)— レビュー指摘は must-fix だけでなく suggestion も原則その場で修正する。見送りは例外(大規模リファクタ相当・設計判断が必要な場合)のみで、必ず Issue 化して追跡する
5. 判断待ちの消化: `/decide` — 無人モードが `needs-decision` に集約した判断依頼を対話で消化し、決定を Issue と docs に反映する

ブランチ名は `feat/issue-<番号>-<slug>`、PR 本文に `Closes #<番号>` を含める。
着手中の Issue には `status:in-progress` ラベルを付与する(`/issue-work` が自動で行う)。

バックログの無人消化: `ready-to-implement` ラベル付き Issue は Routine が毎時 `/issue-work` を無人モードで起動し、1 fire 1件ずつ PR 化する(運用・セットアップ: `docs/automation/backlog-routine.md`)。ready 化は `/issue-create` が作成時に判定するほか、`/backlog-ready` でまとめて行える。依存する先行 Issue が open でも ready は付与でき、着手は Routine の依存チェックが遅延する(マージすると次の fire が自動で後続に着手)。無人モードはユーザー確認の代わりに撤退を選び、マージ判断は必ず人間が行う(`/decide` セッション内の明示承認を含む)。溜まった `needs-decision` は `/decide` でまとめて消化する。

## してはいけないこと

- `packages/domain` に I/O・フレームワーク依存を追加しない(zod のみ)
- ドメイン不変条件を adapters / api 層で再実装しない(superRefine に置く)
- migration SQL を手書きしない(`db:generate` を使う)
- main へ直接 push しない(必ず PR 経由)
- `*.module.css` に色・余白・角丸・フォントサイズの直値を書かない(デザイントークン `var(--*)` を参照する。定義元は `packages/web/src/app/globals.css`)
