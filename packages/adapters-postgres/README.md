# @warimaru/adapters-postgres

ドメイン層が定めた Repository / Query の I/F を PostgreSQL（Drizzle ORM）で実装する層。
本番は Neon（サーバーレス PostgreSQL）に HTTP で接続し、ローカル開発と統合テスト・E2E は素の PostgreSQL に接続する。

## 命名規約

- 実装クラスは `Postgres*Repository` / `Postgres*Query`（例: `PostgresTransactionRepository`、`PostgresDashboardQuery`）。ファイル名はクラス名と一致させ、BC ごとのディレクトリ直下に置いて barrel `index.ts` から再エクスポートする
- 接頭辞は**接続先の製品**（PostgreSQL）を指し、ホスティング先（Neon）は指さない。ローカル開発では素の PostgreSQL に同じクラスで接続するため（#428。旧称は `Neon*`）
- `Neon` の語は Neon 固有のもの（`neon-http` ドライバの選択・エンドポイントのホスト判定）にだけ使う

## `pg` の依存宣言は devDependencies

`pg`（node-postgres ドライバ）と `@types/pg` は devDependencies に置く（#428）。

- 本番は `neon-http` に固定されるため `pg` を読み込まない（`src/client.ts` の `resolveDbDriver`）。読み込まないものを本番向けインストール（`pnpm install --prod`）の成果物に含める理由がない
- 代わりに、本番向けにインストールした環境でローカル向けの接続先を指すと `pg` を解決できずに落ちる。この失敗だけは原因と対処を添えたエラーへ翻訳する（素の `ERR_MODULE_NOT_FOUND` は「DB が落ちている」と読み違えられるため）
- 宣言の位置は `tests/unit/pgDevDependency.test.ts` が、遅延読み込みは `tests/unit/pgLazyLoad.test.ts` と `tests/unit/noStaticNodePgImport.test.ts` が機械的に検出する

## マイグレーション

- テーブル定義（DDL）は `pnpm --filter @warimaru/adapters-postgres db:generate` の生成物のみ。手書きしない（データ移行 DML の例外は CLAUDE.md「してはいけないこと」を参照）
- **適用済みのマイグレーションファイルは書き換えない**。実行行はもちろん、コメントも当時の記録として残す（この層のクラス名が `Neon*` のまま残っている記述があるのはそのため）。適用の要否は `drizzle/meta/_journal.json` の時刻だけで判定されるので、書き換えても再適用されず、本番と手元で違う SQL が当たったまま気づけなくなる
