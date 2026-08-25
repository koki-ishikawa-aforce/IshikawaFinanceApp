---
name: decide
description: needs-decision ラベル付きの判断待ち Issue / PR を1件ずつ対話で消化し、決定を Issue のコメント・ラベルと docs に反映する。判断待ちの処理や、自動マージが止まった PR の判断を依頼されたときに使用する。
---

# 判断セッション(needs-decision の消化)

無人モード(backlog Routine、`docs/automation/backlog-routine.md`)が `needs-decision` ラベルに集約した判断待ちを、「平易な要約 → AskUserQuestion → 記録」のループでユーザーと1件ずつ消化する。決定は Issue のコメント・ラベル遷移として即時確定し、ドメイン上の決定は決定台帳(`docs/domain/03-open-questions.md`)へ、ワークフローの原則にかかわる決定は `docs/workflow/04-principles.md` へ反映する。

> `gh` CLI が使えない環境では GitHub MCP ツールで同等の操作を行う(issue-work スキルの「実行環境の注意」と同じ)。

守るべき不変ルール:

- `status:in-progress` は Routine の排他ロック。付けない・外さない
- **決定コメントが先、ラベル操作・クローズが後**。この順序を守れば途中で中断しても「needs-decision が外れているのに決定の記録がない」状態は生まれない
- 判断の結果 `needs-decision` を外した PR は、次のバックログ fire の**回収マージ**がマージゲートで判定して自動でマージする。急ぐ場合のみこのセッション内で手動マージしてよい(手順3c)
- ユーザーに見せる要約・投稿するコメントはすべて issue-work スキルの「人間向け報告の執筆ルール」に従う(本書には複製しない。必ず参照する)

## 手順

### 1. 判断待ちの取得と分類

#### 1a. 取り込みスイープ(旧ラベル回収 + stale 後始末)

`needs-decision` のアジェンダを取得する前に、導線から漏れた判断待ちを機械的に回収する。

**旧ラベル回収** — `needs-clarification` 付きの open Issue を列挙する:

```bash
gh issue list --state open --label "needs-clarification" --json number,title,body,createdAt,url
```

1件以上あれば、各 Issue に対して:

1. ラベルを付け替える:
   ```bash
   gh label create "needs-decision" --color D93F0B --description "人間の判断待ち" 2>/dev/null || true
   gh issue edit <番号> --add-label "needs-decision" --remove-label "needs-clarification"
   ```
2. 最新コメント(`gh issue view <番号> --comments`)を確認し、`templates/judgment-issue.md` の形式(「🙋 判断してほしいこと」で始まる選択肢形式)になっていなければ、撤退コメントの内容を元に `templates/judgment-issue.md` 形式の判断依頼コメントを投稿する。既にフォーマット済みなら何もしない

**stale 後始末** — `needs-decision` 付きの **closed** Issue を列挙する:

```bash
gh issue list --state closed --label "needs-decision" --json number,title,body,createdAt,url
```

1件以上あれば、アジェンダ末尾に「stale 後始末」として載せる(手順2のアジェンダ提示で末尾に配置)。消化ループ(手順3)での扱い:

- 決定記録コメント(`templates/decision-comment.md` 形式)が既にある → `needs-decision` ラベルを除去するだけ(再オープン不要)
- 未回答の判断依頼が残っている → ユーザーに確認してから決定を記録し、ラベルを除去する

#### 1b. アジェンダの取得

```bash
gh issue list --state open --label "needs-decision" --json number,title,body,labels,assignees,createdAt,url
```

`needs-decision` は PR にも付く(マージゲートの停止スイッチ)。Issue と同じアジェンダに載せるため、PR 側も取得する:

```bash
gh pr list --state open --label "needs-decision" --json number,title,body,labels,url
```

どちらも0件(かつ stale 後始末も0件)なら「判断待ちなし」と報告して終了する。その際、保険として open PR の一覧(`gh pr list --state open --json number,title`)を確認し、マージゲートに落ちたまま `needs-decision` も付いていない PR があれば列挙する(ゲート条件の取りこぼしの可能性がある)。

取得したアイテムを4種に分類する:

| 種別          | 判別方法                                                      | 判断依頼の場所                                  |
| ------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| `main` 赤     | タイトル先頭が `[main 赤]`(本文に `<!-- main-ci-failure -->`) | Issue 本文(ci.yml が固定文面で起票)             |
| マージ保留 PR | `needs-decision` が付いた open PR(PR 側の取得結果)            | 対象 PR と、紐づく元 Issue の最新コメント       |
| 見送り追認    | 本文が `## 🙋 判断してほしいこと` で始まる新規 Issue          | Issue 本文                                      |
| 撤退時の確認  | 上記以外(元タスク Issue に判断依頼が付いたもの)               | 最新コメント(`gh issue view <番号> --comments`) |

マージ保留 PR は状態を確認する: `gh pr view <PR番号> --json state,isDraft,mergeable,statusCheckRollup`。PR が既に merged / closed なら **stale** としてマークする(手順3c の stale 分岐で後始末する)。

> 元 Issue 側に `needs-decision` が付いて止まっている PR(CI が直せずに撤退したケースなど)は「撤退時の確認」として現れる。判断の結果 `needs-decision` を外せば、次の fire の回収マージが CI green を条件にマージする。

### 2. アジェンダ提示と進行順の合意

全量を表(番号・種別・タイトル・作成日)で提示する。推奨順:

1. **`main` 赤**(最優先。`main` が赤い間は無人モードの fire がすべて空振りするため、これを解かないと他をどう判断しても前に進まない)
2. マージ保留 PR(open PR を減らすと WIP 上限が解放され、次の fire が進む)
3. 撤退時の確認(`ready-to-implement` を付け直すと Routine が再稼働する)
4. 見送り追認

stale は末尾に「後始末」として載せる。AskUserQuestion で「この順で全件進める / 一部だけ / 中止」を合意してからループに入る。

### 3. 1件ずつの消化ループ

各アイテムで以下を行う:

1. **要約提示**: 執筆ルールに従い「何の機能の話か(1〜3行)→ 質問1文 → 選択肢と影響 → 推奨」の順で提示する。マージ保留 PR では PR 本文の「この PR でできるようになること」に加え、diff の要約・CI の状態・**マージゲートのどの条件で止まったか**を平易に示す
2. **矛盾チェック**: 論点が `docs/domain/03-open-questions.md` の解決済み行(✅)や関連 OQ に触れる場合は該当行を引用し、矛盾するなら「この決定は 論点N / OQ-N の決定を上書きする」と明示してから質問する
3. **AskUserQuestion**: 判断依頼の選択肢をそのまま options にし、常に「スキップ(今回は判断しない)」を含める。自由回答も受け付ける
4. **記録**: 下の種別プレイブックを即時実行し、1件ごとに GitHub 上の状態を確定させる(docs 編集だけは手順5に繰り越す)
5. **セッション台帳**: 決定内容・実施した操作・docs 反映の要否を台帳(このセッション内のメモ)に追記する

#### 3a. 撤退時の確認(元 Issue)

決定コメントを `templates/decision-comment.md` の形式で投稿してから、決定に応じて:

- **実装する**: 決定が受け入れ条件を変えるなら **Issue 本文の受け入れ条件も編集して決定を織り込む**(次の無人 fire が読むのは本文。コメントだけでは同じ理由で再撤退しうる)。その後ラベルを付け替える:
  ```bash
  gh issue edit <番号> --remove-label "needs-decision" --add-label "ready-to-implement"
  ```
- **自分(人間)でやる**: `--remove-label "needs-decision"` のみ(`ready-to-implement` は付けない)。ユーザーを assign する
- **やらない**: `gh issue close <番号> --reason "not planned"`

#### 3b. 見送り追認 Issue

- **追認(見送りで確定)**: 決定コメント + `gh issue close <番号> --reason "not planned"`
- **実装する**: 決定コメント + `--remove-label "needs-decision" --add-label "ready-to-implement"`(人間が手動でやる場合は ready を付けず assign)

#### 3c. マージ保留 PR(`needs-decision` でマージゲートが止めている PR)

- **進めてよい**: PR から `needs-decision` を外す(元 Issue に付いている場合はそちらも外す)。これだけで次のバックログ fire の回収マージが CI green を条件にマージする。**急ぐ場合のみ**このセッションでマージしてよい: `gh pr merge <PR番号> --squash --delete-branch`(PR が Draft のまま残っている場合のみ先に `gh pr ready <PR番号>`)
- **修正してから**: PR に具体的な修正依頼をコメントし、`needs-decision` は残す(次回セッションで再判断。ラベルが残る限り自動マージされない)
- **不採用**: 理由をコメントし `gh pr close <PR番号> --delete-branch`。**PR をクローズしただけで終えてはならない** — マージされずにクローズされた PR は `.github/workflows/notify-needs-decision.yml` の `unlock-in-progress-on-pr-close` ジョブが元タスク Issue(PR が `Closes #M` で紐づけていた Issue)の `status:in-progress` を自動解除する。`ready-to-implement` は残ったままなので、放置すると**次の fire が却下したばかりの Issue を再実装して PR を作り直すループ**になる。これを防ぐため、元タスク Issue の後始末をユーザーに確認して実施する(元 Issue 番号は `gh pr view <PR番号> --json closingIssuesReferences` で特定する):
  - **(a) 実装自体をやめる**: `gh issue edit <元Issue番号> --remove-label "ready-to-implement"`(完全に取り下げるなら `gh issue close <元Issue番号> --reason "not planned"`)。次の fire は拾わなくなる
  - **(b) 別のアプローチでやり直す**: 元 Issue の受け入れ条件を却下の理由を織り込んで修正したうえで `ready-to-implement` を維持する(`needs-decision` は付けない)。次の fire が修正後の条件で再実装する
- **stale**(PR が既に merged / closed): 何も判断することがないため、`needs-decision` を外すだけでよい。判断依頼コメントが元 Issue に残っている場合は経緯を1行コメントして閉じる

#### 3d. `main` 赤 Issue

判断ではなく復旧の段取りを決める枠。まず現状を確認する: `gh run list --branch main --workflow ci.yml --limit 3 --json conclusion,headSha,url` と、Issue 本文の run URL の失敗ログ。

- **既に復旧している**(最新の `main` の CI が success): 経緯を1行コメントして Issue をクローズする(`needs-decision` も外れる)。無人モードは次の fire から通常どおり動く
- **原因が特定できて修正が小さい**: このセッションで修正 PR を出してよい(`main` へ直接 push しない)。CI が green になったらマージし、`main` の CI が緑へ戻ったことを確認して Issue をクローズする
- **原因の調査が要る / 修正が大きい**: 直す作業そのものを Issue 化する。この `main` 赤 Issue の `needs-decision` は**外さない**(無人モードを止めたままにして巻き添えを防ぐ)。修正 Issue に `ready-to-implement` を付けても、`main` が赤い間は preflight が着手を止めるため、人間が先に直す必要がある点をユーザーに伝える

### 4. docs 反映の判定

ループ中は台帳への記録のみ行い、ファイル編集は手順5でまとめて行う。反映先の判定:

| 決定の性質                                                                                           | 反映先                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 既存の OQ / 論点に対応するドメイン・仕様上の決定                                                     | `03-open-questions.md` の該当行を in-place 編集: ID に `✅`(既存決定の上書きは `✅(改訂)`)+ `**解決（YYYY-MM-DD）**: ...` + Issue 番号の引用(OQ-38 行が見本)                                                                                                                  |
| 既存行のない新規のドメイン決定                                                                       | §B に新規 OQ 行を採番して追加し、その場で ✅ 解決として記録する                                                                                                                                                                                                               |
| 用語・集約・境界づけられたコンテキストの構造に影響する決定                                           | 上記に加えて `docs/domain/07 / 08a〜08h / 09` の該当ファイルを編集し、冒頭の blockquote に日付入りの改訂注記を追加する                                                                                                                                                        |
| ワークフローの運用・原則にかかわる決定(以後も判断基準として参照されるもの。`[改善案]` の採否を含む)  | `docs/workflow/04-principles.md` の該当原則に根拠(どの失敗・判断から来たか)とともに追記する。該当する原則が無ければ新しい原則として追加し、「未解決の課題」に対応する行があればその行も更新する。工程・ラベル・実行基盤の仕様に触れる決定は `docs/workflow/01〜03` も更新する |
| 実装手段の選択・その場限りの運用判断・単純なマージ可否・見送り追認のみ(以後の判断基準にならないもの) | docs 反映なし(Issue の決定コメントで足りる)                                                                                                                                                                                                                                   |

### 5. セッション終了: docs PR(反映対象が1件以上ある場合のみ)

```bash
git fetch origin main && git switch -c docs/decision-session-<YYYYMMDD> origin/main
```

- 手順4で台帳に記録した docs 編集をすべてこのブランチで行い、`pnpm format:check`(必要なら `pnpm format`)を通してコミットする
- PR を作成する。タイトルは `docs: 判断セッション YYYY-MM-DD の決定を反映`、本文に決定ごとの Issue リンクの一覧を載せる
- CI が green になったら AskUserQuestion で「今マージする / レビューに残す」を確認する

### 6. 最終報告

表で報告する:

- 消化件数と種別ごとの内訳
- 各件: Issue / PR 番号・決定・実施した操作(ラベル遷移・クローズ・マージ)
- スキップ・修正待ちの残件
- docs PR の URL(作成した場合)
- `needs-decision` の残数(0 になったか)
- 次に起きること(例: ready を付け直した Issue を次の fire が拾う)

## エッジケース

- **0件**: 手順1で報告して終了。`needs-decision` が付いていないのにマージされずに残っている open PR だけ保険で列挙する
- **スキップ**: 状態変更ゼロ。最終報告の残件に載せる
- **解決済み論点との矛盾**: 手順3-2 で提示し、上書きが確定したら `✅(改訂)` パターンで旧行を改訂する
- **自由回答が選択肢の枠を超える(新要件になっている)**: 全文を決定コメントに記録したうえで `/issue-create` での Issue 化を提案し、その件は `needs-decision` を残してスキップ扱いにする
- **中断**: 決定コメント先行の順序を守っている限り GitHub 側は常に一貫している。失われるのは未作成の docs PR のみで、決定コメントが一次記録なので次回の `/decide` か手動 PR で追いつける
