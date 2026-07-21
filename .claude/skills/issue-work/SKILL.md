---
name: issue-work
description: GitHub Issue を起点に実装から PR 作成まで行う。Issue 番号を指定した実装依頼、または「次のタスクをやって」のように番号なしで実装を依頼されたときに使用する。
---

# Issue 実装ワークフロー

GitHub Issue を起点に、実装 → 検証ループ → DDD レビュー → PR → CI green までを一貫して行う。

## 0. Issue の選定(番号が指定されなかった場合のみ)

番号なしで起動されたら、着手すべき Issue を自動選定する:

1. `gh issue list --state open --json number,title,labels,assignees,createdAt` で open な Issue を取得する
2. 以下の優先順で候補を1つ選ぶ:
   - `priority:high` などの優先度ラベルが付いているもの
   - 本文中で他の open Issue に依存していない(ブロックされていない)もの
   - 同条件なら作成が古いもの
3. 他の人が assign 済みのもの、進行中の PR にリンク済みのもの、`status:in-progress` ラベルが付いているものは除外する
4. **選んだ Issue の番号・タイトル・選定理由を提示し、ユーザーの了承を得てから**手順1に進む(別候補があればそれも1行で添える)

open な Issue が1件もなければ、その旨を報告して `/issue-create` を提案する。

## 1. Issue の理解

- `gh issue view <番号>` で本文と受け入れ条件を取得する
- 対象の境界づけられたコンテキストを特定し、`docs/domain/09-aggregates.md` と該当するユビキタス言語資料(`docs/domain/08a`〜`08h`)を読む
- 受け入れ条件が曖昧、または設計判断が分かれる場合は、**実装前に**ユーザーへ確認する

## 2. ブランチ作成と着手宣言

main を最新化してから作成する:

```bash
git fetch origin main && git switch -c feat/issue-<番号>-<slug> origin/main
```

Issue に `status:in-progress` ラベルを付与して着手中であることを示す(ラベルが未作成でも失敗しないよう冪等に作成する):

```bash
gh label create "status:in-progress" --color FBCA04 --description "着手中" 2>/dev/null || true
gh issue edit <番号> --add-label "status:in-progress"
```

## 3. 計画と実装

- 変更対象ファイルを列挙してから着手する
- 依存の向きに沿って `domain → adapters-neon → api → web` の順に実装する
- テストは実装と同時に書く。**集約の状態遷移・不変条件のテストは必須**
- 命名は `packages/domain/README.md` とユビキタス言語に従う

## 4. 検証ループ(内側ループ)

`/verify` の手順を全 green になるまで繰り返す。green になるまで次工程に進まない。

## 5. DDD レビュー

`/ddd-review` を実行し(ddd-reviewer サブエージェントが main との diff をレビュー)、must-fix と suggestion を修正したら再度 `/verify` を回す。suggestion は原則この場で対応し、見送るのは `/ddd-review` の例外基準に該当する場合のみ(その際は Issue 化して追跡する)。

## 6. PR 作成と CI ループ(外側ループ)

1. 受け入れ条件のチェックボックスを満たしているか最終確認する
2. `git push -u origin HEAD`
3. `gh pr create` — PR テンプレートに従い、本文に `Closes #<番号>` を含める
4. CI の結果を確認する: `gh pr checks --watch`
5. CI が失敗したら `gh run view <run-id> --log-failed` で原因を取得し、修正 → `/verify` → push を CI が green になるまで繰り返す

PR が green になったら、PR の URL と受け入れ条件の充足状況をユーザーに報告して完了。

補足: PR マージで Issue は自動クローズされる(`Closes #<番号>`)。マージまで見届ける場合は `gh issue edit <番号> --remove-label "status:in-progress"` でラベルを外す。クローズ済み Issue にラベルが残っていても実害はない。
