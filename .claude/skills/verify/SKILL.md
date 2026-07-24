---
name: verify
description: コード変更後の検証ループ。build・typecheck・test・lint・format:check を全て green にする。コード変更を完了と報告する前、および PR 作成前に必ず使用する。
---

# 検証ループ

CI(`.github/workflows/ci.yml`)と同一のチェックをローカルで全 green にする。これが「実装完了」の定義。

## 手順

以下を順に実行する:

1. `pnpm build`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm lint`
5. `pnpm format:check`

**失敗したら**: エラーメッセージを読み、原因に対する最小の修正を行い、**失敗したステップから**再実行する。全ステップが green になるまで繰り返す。

- `format:check` の失敗は `pnpm format` で機械修正してよい
- テスト失敗時は、テストが正で実装が誤りという前提から始める。テスト自体を変更する場合は理由を明示する

## 統合テスト(条件付き)

`pnpm test` は各パッケージの `vitest run` で、adapters-neon の統合テスト(`test:integration`・別 config・要 PostgreSQL)を**含まない**。CI(`.github/workflows/ci.yml`)は別ステップで必ず実行するため、ローカル `pnpm test` が全 green でも CI が赤になりうる。以下の実行判定に該当したら、この節の統合テストまで green にして初めて「実装完了」とみなす。

### 実行判定(いつ走らせるか)

次の**いずれか**に変更がある場合に実行する:

- `packages/adapters-neon` の `src/`(特に `src/schema/`)や `drizzle/`
- `packages/domain`(集約・value object・Query 契約・プライバシーフィルタなどの**振る舞い**)

理由: 統合テストは `NeonTransactionListQuery` などの実装だけでなく、**domain 層のプライバシー/Query 挙動**を通しで検証する。domain の振る舞いを変えると adapters-neon の実装ファイルを一切触らなくても統合テストが壊れることがある(実例: `applyPrivacyFilter` の変更で `transactionListQuery.test.ts` が失敗)。判定を「adapters-neon の変更」だけに閉じると、この種の回帰を取りこぼす。迷ったら実行する。

### 実行方法

まず docker compose を試す:

```bash
docker compose up -d db
DATABASE_URL=postgres://postgres:postgres@localhost:5432/warimaru_test \
  pnpm --filter @warimaru/adapters-neon test:integration
```

DB の状態が怪しいときは `docker compose down && docker compose up -d db` でリセットする。

### フォールバック(イメージ pull が塞がれた環境)

ネットワークポリシーで `postgres:16` イメージの pull が 403(Forbidden)になる環境(Routine 相当の無人セッションなど)では docker compose が使えない。その場合は、環境にインストール済みの PostgreSQL 16 バイナリを直接起動してテストする:

```bash
# postgres ユーザーで initdb → 起動(バイナリのパスは環境により異なる)
PGBIN=/usr/lib/postgresql/16/bin
PGDATA=/tmp/warimaru_pg
sudo -u postgres "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
sudo -u postgres "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p 5432" -l /tmp/warimaru_pg.log start
sudo -u postgres "$PGBIN/createdb" -p 5432 warimaru_test

DATABASE_URL=postgres://postgres:postgres@localhost:5432/warimaru_test \
  pnpm --filter @warimaru/adapters-neon test:integration
```

`sudo -u postgres` が使えない/バイナリのパスが違う場合は環境に合わせて読み替える。docker もローカルバイナリも使えず統合テストをどうしても実行できないときは、その事実を隠さず報告する(無人モードでは「CI で初めて検証される未確認の変更」として扱い、手順6 の CI 確認を必須とする)。

## ビジュアルリグレッションテスト — VRT(条件付き)

CI は Playwright によるビジュアルリグレッションテスト(`pnpm --filter @warimaru/web test:e2e`)を実行する。`packages/web` に変更がある場合はローカルでも実行し、green を確認する。

### 実行判定(いつ走らせるか)

`packages/web` 配下のファイル(`src/`・`e2e/` 等)に変更がある場合に実行する。迷ったら実行する。

### 実行方法

実行環境にプリインストール済みの Chromium を利用する(`PLAYWRIGHT_BROWSERS_PATH` が設定済みの環境では追加インストール不要)。Playwright ブラウザが未インストールの環境では先に `pnpm --filter @warimaru/web exec playwright install --with-deps chromium` を実行する。

```bash
pnpm --filter @warimaru/web test:e2e
```

## ループの打ち切り

同一のエラーに対する修正が3回連続で失敗したら、ループを止めてユーザーに報告する:

- 何が失敗しているか(エラー全文の要点)
- 試した修正と結果
- 考えられる選択肢

無限ループは禁止。行き詰まりを隠して作業を続けない。
