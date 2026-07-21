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

`packages/adapters-neon` の `src/`(特に `src/schema/`)や `drizzle/` を変更した場合のみ実行する:

```bash
docker compose up -d db
DATABASE_URL=postgres://postgres:postgres@localhost:5432/warimaru_test \
  pnpm --filter @warimaru/adapters-neon test:integration
```

DB の状態が怪しいときは `docker compose down && docker compose up -d db` でリセットする。

## ループの打ち切り

同一のエラーに対する修正が3回連続で失敗したら、ループを止めてユーザーに報告する:

- 何が失敗しているか(エラー全文の要点)
- 試した修正と結果
- 考えられる選択肢

無限ループは禁止。行き詰まりを隠して作業を続けない。
