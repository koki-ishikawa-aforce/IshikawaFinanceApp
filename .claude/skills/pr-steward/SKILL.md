---
name: pr-steward
description: open な自動 PR(Routine 起点)の CI 失敗修復・コンフリクト解消・重複検知を行う。マージは絶対に行わない。
---

# PR 執事ワークフロー

Routine が無人モードで作成した open PR を巡回し、CI 失敗の診断・修正 push、コンフリクトの解消、重複 PR の検知を行う。**マージは絶対に行わない**（マージ判断は人間の原則を維持）。

> **実行環境の注意**: 本書の `gh` コマンドは操作の意図を示すリファレンス。`gh` CLI が使えない環境では GitHub MCP ツール(`mcp__github__*`)で同等の操作を行う。

## 手順

### 1. 対象 PR の列挙

open な PR のうち、Routine 起点（無人モード）で作成されたものを列挙する:

```bash
gh pr list --state open --json number,title,headRefName,body,labels
```

Routine 起点の判別基準: PR 本文に「無人モードの選定理由」セクションが含まれている、またはマージ判断 Issue（`[マージ判断] PR #N` タイトル）が紐づいている。判別できないものは対象外とする。

### 2. 各 PR の購読と点検

対象 PR それぞれについて `subscribe_pr_activity` で購読し、以下の点検を行う:

#### 2a. 重複 PR の検知

PR 本文の `Closes #N` から対象 Issue 番号 `N` を抽出し:

- 同じ Issue 番号 `N` を `Closes` する **別の open PR** が存在するか検索する
- 対象 Issue `N` が既にクローズ済みかを確認する

**いずれかに該当する場合**: 重複 PR は自動クローズせず、対象 PR と対象 Issue の両方に `needs-decision` ラベルを付与し、判断依頼コメントを残す（`.claude/skills/issue-work/templates/judgment-issue.md` のフォーマットに従う）。コメントには重複している PR 番号の一覧と、どの PR を残すべきかの判断を人間に委ねる旨を記載する。

#### 2b. CI 失敗の診断と修正

PR の checks/statuses を確認し、失敗しているものがあれば:

1. 失敗したジョブのログを取得する（GitHub MCP: `get_job_logs` または `gh run view <run-id> --log-failed`）
2. 失敗原因を診断する
3. PR の head ブランチをチェックアウトし、修正を実装する
4. `/verify` で全 green を確認してから push する
5. CI の再実行を待ち、green を確認する
6. **同一エラーで3回**修正に失敗したら、マージ判断 Issue に状況を記録して次の PR へ進む（無限リトライの歯止め）

#### 2c. コンフリクトの解消

PR がマージコンフリクト状態の場合:

1. PR の head ブランチをチェックアウトする
2. base ブランチ（通常は `main`）を fetch してマージする:
   ```bash
   git fetch origin main
   git merge origin/main
   ```
3. コンフリクトを解消する（ドメインロジックの競合など、判断が必要な場合は `needs-decision` で人間に委ねる）
4. `/verify` で全 green を確認してから push する

### 3. 完了報告

全対象 PR の点検が終わったら、結果を報告する:

- 修正 push した PR の一覧（何を修正したか1行ずつ）
- `needs-decision` に回した PR の一覧（理由つき）
- 全 PR が green の場合はその旨を報告する

## 制約

- **マージは絶対に行わない** — マージ判断は人間が `/decide` または手動で行う
- **自動クローズはしない** — 重複 PR の検知時も `needs-decision` で人間に委ねる
- **対象は Routine 起点の PR のみ** — 人間が手動で作成した PR には触れない
- 修正 push は `/verify` 全 green を経由してから行う
