---
name: issue-work
description: GitHub Issue を起点に実装から PR 作成まで行う。Issue 番号を指定して実装を依頼されたときに使用する。
---

# Issue 実装ワークフロー

GitHub Issue を起点に、実装 → 検証ループ → DDD レビュー → PR → CI green までを一貫して行う。

## 1. Issue の理解

- `gh issue view <番号>` で本文と受け入れ条件を取得する
- 対象の境界づけられたコンテキストを特定し、`docs/domain/09-aggregates.md` と該当するユビキタス言語資料(`docs/domain/08a`〜`08h`)を読む
- 受け入れ条件が曖昧、または設計判断が分かれる場合は、**実装前に**ユーザーへ確認する

## 2. ブランチ作成

main を最新化してから作成する:

```bash
git fetch origin main && git switch -c feat/issue-<番号>-<slug> origin/main
```

## 3. 計画と実装

- 変更対象ファイルを列挙してから着手する
- 依存の向きに沿って `domain → adapters-neon → api → web` の順に実装する
- テストは実装と同時に書く。**集約の状態遷移・不変条件のテストは必須**
- 命名は `packages/domain/README.md` とユビキタス言語に従う

## 4. 検証ループ(内側ループ)

`/verify` の手順を全 green になるまで繰り返す。green になるまで次工程に進まない。

## 5. DDD レビュー

`/ddd-review` を実行し(ddd-reviewer サブエージェントが main との diff をレビュー)、must-fix を修正したら再度 `/verify` を回す。

## 6. PR 作成と CI ループ(外側ループ)

1. 受け入れ条件のチェックボックスを満たしているか最終確認する
2. `git push -u origin HEAD`
3. `gh pr create` — PR テンプレートに従い、本文に `Closes #<番号>` を含める
4. CI の結果を確認する: `gh pr checks --watch`
5. CI が失敗したら `gh run view <run-id> --log-failed` で原因を取得し、修正 → `/verify` → push を CI が green になるまで繰り返す

PR が green になったら、PR の URL と受け入れ条件の充足状況をユーザーに報告して完了。
