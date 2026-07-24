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

`/verify` の実行判定に該当する変更(`packages/domain` の振る舞い、または `packages/adapters-neon`)がある場合は、**統合テストまで green にする**(`pnpm test` は統合テストを含まないため、これを省くと CI で初めて赤が判明する)。実行方法とフォールバックは `/verify` の「統合テスト」節に従う。

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

### 原則: 人間の判断は Issue に集約する

無人モードでユーザーの判断が必要になったら、種類を問わず **`needs-decision` ラベル付きの Issue** に集約する(チャットの最終報告や PR 本文だけに書いて済ませない)。判断が必要な事象は3種:

1. **撤退時の確認**(受け入れ条件が曖昧・設計判断が分かれる) → 元 Issue に判断依頼コメント + `needs-decision`
2. **見送り追認**(`/ddd-review` suggestion の見送りなど) → 新規 Issue + `needs-decision`
3. **マージ判断** → 無人モードが作成した PR ごとに新規 Issue + `needs-decision`

これによりユーザーは `is:issue is:open label:needs-decision` の一覧だけで判断すべきことを全量把握でき、ラベル付与をトリガーに通知ワークフロー(`.github/workflows/notify-needs-decision.yml`)がメール通知を発生させる。

判断依頼・PR の本文を書く前に、**必ず対応するテンプレート(`templates/judgment-issue.md` / `templates/pr-body.md`)を読み**、そのフォーマットで書く。

### 人間向け報告の執筆ルール

判断依頼 Issue・コメント・PR 本文など、人間が読む出力すべてに適用する:

- 読み手はこのセッションの経緯を**一切見ていない**前提で書く。前置きなしにセッション中の出来事や検討過程へ言及しない
- 冒頭に「何の機能の話か」をアプリを使う人の言葉で1〜3行書く(技術構成ではなく「使う人に何が起きるか」で説明する)
- 判断依頼は「質問1文(疑問文)→ 選択肢 → 各選択肢を選んだ場合の影響」の順で書く
- 専門用語・略語には初出時に括弧で平易な説明を添える(例: 「fail-open(異常時にチェックを素通しにしてしまう状態)」)
- 結論・質問を先頭に置き、技術詳細は後ろに回す。体言止めや用語の羅列を避け、主語と述語のある文で書く
- 量より選別。判断に影響しない詳細は書かない

### 手順0の代替: 着手判定

**preflight — ゴミロックの回収(self-heal)**: 候補選定の前に、fire の異常終了や PR のクローズで放置された着手中ロックを回収する。これを怠ると、`ready-to-implement` な Issue すべてに死んだ `status:in-progress` が残り、候補が 0 件になって**毎 fire スキップし続ける**(バックログが止まる)。`status:in-progress` が付いた open Issue を列挙し、次の**両方**を満たすものから `status:in-progress` だけを外す(他ラベルは触らない):

- **紐づく open な PR が無い**: PR 本文の `Closes #<番号>`、または head ブランチ `feat/issue-<番号>-*` のいずれでも open な PR に紐づかない(= 実装中の生きた fire が存在しない)
- **ロックが古い**: `status:in-progress` の付与がおおむね2時間以上前(1 fire のセッション寿命を大きく超える)。付与直後の Issue は並行 fire が実装中の可能性があるため回収しない(誤回収による二重着手を防ぐ)

回収した Issue はそのまま下の候補選定で拾い直せる(`ready-to-implement` が残っていれば対象に戻る)。回収した Issue 番号は最終報告に含める。なお PR を**未マージでクローズ**したことによるロック残りは `.github/workflows/notify-needs-decision.yml` が即時に解除するため、この preflight はおもに「PR を作らずに死んだ fire」の取りこぼしを拾う保険となる。

1. **WIP 上限チェック**: open な PR の件数を数える:
   ```bash
   gh pr list --state open --json number --jq 'length'
   ```
   **5件以上**なら新規着手せず、「WIP 上限のためスキップ」と報告して終了する(レビュー待ち PR が溜まった状態で着手を重ねると、PR 同士のコンフリクトと依存切れを招くため)
2. **候補選定**: `gh issue list --state open --label "ready-to-implement" --json number,title,labels,assignees,body,createdAt` から、以下をすべて満たす Issue を1件選ぶ:
   - `status:in-progress` / `needs-decision` ラベルが付いていない
   - 誰にも assign されていない
   - 本文の「依存」「先行」「関連」に挙げられた先行 Issue がすべてクローズ済み(open のものに依存していない)。依存待ちの ready Issue は正常な状態であり、条件を満たすまで単にスキップして次候補を見る(先行 Issue のマージ後、以降の fire が自動で拾う)
     優先順は `priority:high` → 作成が古い順。候補が1件もなければ「ready な Issue なし」と報告して終了する
3. **排他ロック**: 選定したら手順1より前に直ちに `status:in-progress` ラベルを付与する(手順2のコマンドを前倒しで実行)。これが並行する fire との排他ロックになる
4. 選定理由はユーザーに確認せず、最終報告に含める

### 手順1・5の差分: 確認の代わりに判断依頼を残して撤退

- 受け入れ条件が曖昧、または設計判断が分かれる場合は**実装しない**。`templates/judgment-issue.md` のフォーマットで判断依頼を元 Issue にコメントし、ラベルを付け替えて終了する:
  ```bash
  gh issue comment <番号> --body "<templates/judgment-issue.md に従った判断依頼>"
  gh label create "needs-decision" --color D93F0B --description "人間の判断待ち" 2>/dev/null || true
  gh issue edit <番号> --add-label "needs-decision" --remove-label "ready-to-implement" --remove-label "status:in-progress"
  ```
  (`needs-decision` はユーザーが回答して `needs-decision` を外し `ready-to-implement` を付け直すまで無人モードの対象外になる)
- `/ddd-review` の suggestion でユーザーの意思決定が必要なもの(見送り例外に該当)は、既存ルール通り Issue 化する。その Issue も `templates/judgment-issue.md` のフォーマットで書き、`needs-decision` を付与したうえで、PR 本文の「あなたに判断してほしいこと」からリンクする

### 手順6の差分: PR 作成・CI green の確認・マージ判断 Issue

- PR 本文は `templates/pr-body.md` のフォーマットで書き、通常の PR(Draft ではない)として作成する。ただし**マージ判断は必ず人間が行う**(自動マージは禁止。マージは `/decide` セッション内の明示承認か、ユーザー自身の操作でのみ行われる)
- PR 作成後、**マージ判断 Issue** を作成する:
  - タイトル: `[マージ判断] PR #<PR番号> <PRタイトル>`
  - 本文: `templates/judgment-issue.md` に従い、先頭にマーカー `<!-- merge-judgment-pr: <PR番号> -->` を含める(PR のマージ/クローズ時に通知ワークフローがこの Issue を自動クローズするための目印)
  - ラベル: `needs-decision`

#### 「完了」の定義: PR の CI が green であること

**無人モードの1 fire は、PR 作成では終わらない。作成した PR の CI(`.github/workflows/ci.yml`)が green になるのを確認して初めて完了とする。** ローカルの `/verify` が全 green でも、統合テストをローカルで実行できなかった場合(イメージ pull 不可のフォールバックも失敗した等)は、CI が初めて統合テストを走らせる。ここを確認せずに fire を終えると「ルーティンは完了・PR は CI 赤」の不整合が残り、以降の fire も拾わない(この不整合の再発防止が本手順の目的)。

1. PR 作成後、**同一 fire セッション内で CI の完了を待つ**。`gh pr checks <PR番号> --watch`(または GitHub MCP で checks/statuses をポーリング)で結果を得る。CI はネットワーク待ちを含むため、`sleep` で潰さず、チェック状態が確定するまで待機する
2. **green** なら、PR とマージ判断 Issue の URL・受け入れ条件の充足状況・選定理由を最終報告して完了
3. **赤**なら、対話モードと同じ修正ループに入る: `gh run view <run-id> --log-failed`(または MCP で失敗ジョブのログ取得)で原因を特定 → 修正 → `/verify`(統合テスト含む)→ 再 push を、CI が green になるまで同一 fire 内で繰り返す
4. **同一エラーで3回**修正に失敗したら、無限リトライを避けて撤退する。マージ判断 Issue に状況(何の CI ジョブが・どんなエラーで失敗し、何を試したか)を執筆ルールに従ってコメントし、その旨を最終報告して終了する(赤いまま PR は残るが、判断待ちとして人間に可視化される)

補足(セッション寿命が尽きて CI を待ち切れない場合): fire が CI 完了前に終了する場合は、マージ判断 Issue に「CI 未確認のまま終了した(要 CI 確認)」旨を執筆ルールに従って明記する。PR は通知ワークフロー(`notify-pr-opened`)でオーナーに assign 済みのため人間には可視化されるが、CI 赤の見落としを防ぐため判断依頼側にも残す。**第一義は同一 fire 内での green 確認**であり、待ち切れは例外扱いとする。
