---
name: issue-work
description: GitHub Issue を起点に実装から PR 作成まで行う。Issue 番号を指定した実装依頼、または「次のタスクをやって」のように番号なしで実装を依頼されたときに使用する。「無人モードで」と指示された場合(Routine からの自動起動)は無人モードの手順に従う。
---

# Issue 実装ワークフロー

GitHub Issue を起点に、実装 → 検証ループ → DDD レビュー → PR → CI green までを一貫して行う。

2つのモードがある:

- **対話モード**(既定): 以下の手順0〜6に従う。判断に迷ったらユーザーに確認する
- **無人モード**: 「無人モードで」と明示されて起動された場合(主に Routine からの自動起動)。手順の差分は末尾の「無人モード」節に従う。ユーザーへの確認は一切行わず、確認が必要な状況では**実装せずに撤退する**

> **実行環境の注意**: 本書の `gh` コマンドは操作の意図を示すリファレンス。`gh` CLI が使えない環境(Claude Code on the web / Routine 起動セッションなど)では、GitHub MCP ツール(`mcp__github__*`: `list_issues` / `issue_read` / `issue_write` / `add_issue_comment` / `list_pull_requests` / `create_pull_request` など)で同等の操作を行う。どちらも使えない場合は GitHub 操作を伴う手順を実行できないため、その旨を報告して終了する(無人モードでは何も変更せず終了)。

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

## 無人モード(Routine からの自動起動)

Routine のセットアップ手順とラベル運用は `docs/automation/backlog-routine.md` を参照。無人モードでは以下の差分を適用する。**1回の起動で処理するのは1 Issue のみ**。完了しても次の Issue には進まない(次の fire が拾う)。

### 手順0の代替: 着手判定

1. **WIP 上限チェック**: open な Draft PR の件数を数える:
   ```bash
   gh pr list --state open --json isDraft --jq '[.[] | select(.isDraft)] | length'
   ```
   **3件以上**なら新規着手せず、「WIP 上限のためスキップ」と報告して終了する(レビュー待ち PR が溜まった状態で着手を重ねると、PR 同士のコンフリクトと依存切れを招くため)
2. **候補選定**: `gh issue list --state open --label "ready-to-implement" --json number,title,labels,assignees,body,createdAt` から、以下をすべて満たす Issue を1件選ぶ:
   - `status:in-progress` / `needs-clarification` ラベルが付いていない
   - 誰にも assign されていない
   - 本文の「依存」「先行」「関連」に挙げられた先行 Issue がすべてクローズ済み(open のものに依存していない)
     優先順は `priority:high` → 作成が古い順。候補が1件もなければ「ready な Issue なし」と報告して終了する
3. **排他ロック**: 選定したら手順1より前に直ちに `status:in-progress` ラベルを付与する(手順2のコマンドを前倒しで実行)。これが並行する fire との排他ロックになる
4. 選定理由はユーザーに確認せず、最終報告に含める

### 手順1・5の差分: 確認の代わりに撤退

- 受け入れ条件が曖昧、または設計判断が分かれる場合は**実装しない**。確認したい点を Issue にコメントで残し、ラベルを付け替えて終了する:
  ```bash
  gh issue comment <番号> --body "<確認したい点>"
  gh label create "needs-clarification" --color D93F0B --description "受け入れ条件の確認待ち" 2>/dev/null || true
  gh issue edit <番号> --add-label "needs-clarification" --remove-label "ready-to-implement" --remove-label "status:in-progress"
  ```
  (`needs-clarification` はユーザーが回答して `ready-to-implement` を付け直すまで無人モードの対象外になる)
- `/ddd-review` の suggestion でユーザーの意思決定が必要なもの(見送り例外に該当)は、既存ルール通り Issue 化したうえで、PR 本文の「レビューで見送った点」に列挙する

### 手順6の差分: Draft PR で止める

- `gh pr create --draft` で **Draft PR** として作成する。マージ判断は必ず人間が行う(自動マージ・ready 化は禁止)
- CI が green になったら、PR の URL・受け入れ条件の充足状況・選定理由を最終報告して終了する。CI が失敗した場合の修正ループは対話モードと同じだが、同一エラーで3回失敗したら PR にその旨をコメントして終了する(無限リトライ禁止)
