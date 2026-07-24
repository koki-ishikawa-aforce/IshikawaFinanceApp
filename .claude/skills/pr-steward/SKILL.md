---
name: pr-steward
description: open な自動 PR(Routine 起点)の CI 失敗修復・コンフリクト解消・重複検知を行う。マージは絶対に行わない。
---

# PR 執事ワークフロー

Routine が無人モードで作成した open PR を巡回し、CI 失敗の診断・修正 push、コンフリクトの解消、重複 PR の検知を行う。**マージは絶対に行わない**(マージ判断は人間の原則を維持)。

> **実行環境の注意**: 本書の `gh` コマンドは操作の意図を示すリファレンス。`gh` CLI が使えない環境では GitHub MCP ツール(`mcp__github__*`)で同等の操作を行う。

## 手順

### 1. 対象 PR の列挙

open な PR のうち、Routine 起点(無人モード)で作成されたものを、**マージ可能状態(mergeable)つきで**列挙する:

```bash
gh pr list --state open --json number,title,headRefName,body,labels,mergeable
```

GitHub MCP の場合、一覧 API(`list_pull_requests`)には mergeable が含まれないため、open PR を取得したうえで PR ごとに `pull_request_read` method `get` を呼び、`mergeable` / `mergeable_state` を得る。

> **mergeable は照会して初めて計算される**: GitHub は PR の mergeable 状態を要求されて初めて算出するため、直後の照会では `mergeable` が `null`(REST)/ `UNKNOWN`(`gh`・GraphQL)、`mergeable_state` が `unknown` を返すことがある。**`unknown` が返った PR は数秒待って再照会する**(例: 2〜3秒間隔で最大3回程度)。リトライしても `unknown` のまま確定しない PR は、手順 2c のコンフリクト判定を保留し、その旨を手順3の完了報告に記す(確定できないものを誤って「問題なし」と扱わない)。

Routine 起点の判別基準: PR 本文に「無人モードの選定理由」セクションが含まれている、head ブランチが `feat/issue-N-` または `claude/issue-N-` で始まる、またはマージ判断 Issue(`[マージ判断] PR #N` タイトル)が紐づいている。判別できないものは対象外とする。

### 2. 各 PR の点検

対象 PR それぞれについて以下の点検を行う。

`subscribe_pr_activity` の購読は**修正 push 後に CI 結果を待つ PR に限って**行い、fire を終える前に `unsubscribe_pr_activity` で解除する(定期 fire の fresh session が毎回全 PR を購読すると、終了済みセッション宛ての購読が fire のたびに蓄積するため。点検だけで修正が不要だった PR は購読しない)。

#### 2a. 重複 PR の検知

PR 本文の close キーワード(`.claude/skills/issue-work/SKILL.md` 無人モード preflight の「close キーワード集合」に従う)から対象 Issue 番号 `N` を抽出し:

- 同じ Issue 番号 `N` を close キーワードで参照する**別の open PR** が存在するか検索する
- 対象 Issue `N` が既にクローズ済みかを確認する

**いずれかに該当する場合**: 重複 PR は自動クローズせず、対象 PR と対象 Issue の両方に `needs-decision` ラベルを付与し、判断依頼コメントを残す(`.claude/skills/issue-work/templates/judgment-issue.md` のフォーマットに従う)。コメントには重複している PR 番号の一覧と、どの PR を残すべきかの判断を人間に委ねる旨を記載する。

PR 本文に番号付きの close キーワードが**1つも無い**場合(例: `Closes #` のまま番号が欠落)も異常として扱い、その PR に `needs-decision` を付けて本文の修正を判断依頼する(番号が無いと重複ガードとロック自動解除がその PR を検知できないため)。

#### 2a-2. 本文のリテラル `\n` 検知(auto-close 不発の予防)

PR 本文(API の生データ)に**リテラルの `\n`(バックスラッシュ + n の2文字)** が含まれていないかを確認する。含まれている場合、`Closes #N` が GitHub の close キーワードとして認識されず、マージしても Issue が自動クローズされない(2026-07-24 の #136 / PR #182 で実際に発生)。これは判断不要の機械的な異常のため `needs-decision` に回さず、**その場で本文を修正 push する**: リテラル `\n` を実際の改行に置換した本文で PR を更新し(`gh pr edit --body-file` または MCP `update_pull_request`。更新時も実際の改行を含む文字列で渡す)、修正後に `Closes #N` が行頭にあることを再確認する。修正はマージ前でなければ効果がない(マージ後の本文修正では auto-close は遡って発動しない)。

#### 2b. CI 失敗の診断と修正

PR の checks/statuses を確認し、失敗しているものがあれば:

1. 失敗したジョブのログを取得する(GitHub MCP: `get_job_logs` または `gh run view <run-id> --log-failed`)
2. 失敗原因を診断する
3. PR の head ブランチをチェックアウトし、修正を実装する
4. `/verify` で全 green を確認してから push する
5. CI の再実行を待ち、green を確認する(この待機に `subscribe_pr_activity` を使ってよい。終了前に解除する)
6. **同一エラーで3回**修正に失敗したら、マージ判断 Issue に状況を記録して次の PR へ進む(無限リトライの歯止め)

#### 2c. コンフリクトの解消

**発動条件(機械的に判定)**: 手順1で得た mergeable が **`mergeable == CONFLICTING`(`gh` / GraphQL)または `mergeable_state == dirty`(REST / MCP)** の PR を対象とする。`mergeable == MERGEABLE` / `mergeable_state == clean` は対象外。`unknown`(計算中)は手順1のリトライで確定させてから判定し、確定しなければ解消を保留して報告に記す(発動条件を自然言語で緩めない)。

発動条件に該当する PR について以下を行う:

1. PR の head ブランチをチェックアウトする
2. base ブランチ(通常は `main`)を fetch してマージする:
   ```bash
   git fetch origin main
   git merge origin/main
   ```
3. コンフリクトを解消する(ドメインロジックの競合など、判断が必要な場合は `needs-decision` で人間に委ねる)
4. `/verify` で全 green を確認してから push する
5. **push が non-fast-forward で拒否された場合**(バックログ Routine の preflight など別セッションが同じ PR ブランチをほぼ同時に修復した競合。コンフリクト解消はこの手順と `/issue-work` 無人モードの preflight の2か所が担うため起こりうる): `git fetch origin <PRのheadブランチ>` でリモートを取り直し、mergeable を再確認する。**既に解消済み**(`mergeable == MERGEABLE` / `mergeable_state == clean`。別セッションが先に修復した)なら何もせず次の PR へ進む。**まだコンフリクトが残る**場合のみ、取り直した head に base を再度マージして解消し **1回だけ** push をやり直す。それでも拒否されたら、その PR の解消を保留して手順3の完了報告に記し、次の PR へ進む(同じ競合で押し合いを続けない)

### 3. 完了報告

全対象 PR の点検が終わったら、結果を報告する:

- 修正 push した PR の一覧(何を修正したか1行ずつ)
- `needs-decision` に回した PR の一覧(理由つき)
- 全 PR が green の場合はその旨を報告する

報告の前に、この fire で購読した PR の `subscribe_pr_activity` をすべて解除したことを確認する。

## 制約

- **マージは絶対に行わない** — マージ判断は人間が `/decide` または手動で行う
- **自動クローズはしない** — 重複 PR の検知時も `needs-decision` で人間に委ねる
- **対象は Routine 起点の PR のみ** — 人間が手動で作成した PR には触れない
- 修正 push は `/verify` 全 green を経由してから行う
- 購読(`subscribe_pr_activity`)は CI 待ちの間だけ。fire 終了前に必ず解除する
