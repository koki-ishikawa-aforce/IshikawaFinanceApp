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
- 依存の向きに沿って `domain → adapters-postgres → api → web` の順に実装する
- テストは実装と同時に書く。**集約の状態遷移・不変条件のテストは必須**
- 命名は `packages/domain/README.md` とユビキタス言語に従う
- `packages/domain` の公開 API(集約・値オブジェクト・Repository / Query インターフェース・ドメインイベント・エラー型・公開定数など)を追加・変更・改名した場合は、**同じ PR で `packages/domain/README.md` の該当セクションを更新する**(この一覧は手動保守の一次資料で、更新漏れは `/ddd-review` で毎回指摘される。#607)
- **新しい集約・ユビキタス言語の用語を導入する場合は、同じ PR 内で `docs/domain/09-aggregates.md`・該当するユビキタス言語資料(`docs/domain/08a`〜`08h`)を実装より先に(または同時に)更新する**(design-first 規約。docs が実装より古い期間を作らない。根拠は `docs/workflow/04-principles.md` 原則12)
- 画面に「読み込み中・エラー・保存結果」のような**ページ遷移を伴わず動的に切り替わる領域**を追加・変更した場合は、`docs/design/usability.md` §8-4(動的更新の通知)を実装時にセルフチェックする — 差し替わる領域に `role="status"`(`aria-live="polite"`)、致命的な通知に `role="alert"` が付いているか。共通部品(`LoadingState` / `EmptyState` / `ErrorState`)を使えば通知が付くため、書き起こさず共通部品を使う(レビューで毎回指摘される抜けの筆頭。#606)

## 4. 検証ループ(内側ループ)

`/verify` の手順を全 green になるまで繰り返す。green になるまで次工程に進まない。

`/verify` の実行判定に該当する変更(`packages/domain` の振る舞い、または `packages/adapters-postgres`)がある場合は、**統合テストまで green にする**(`pnpm test` は統合テストを含まないため、これを省くと CI で初めて赤が判明する)。実行方法とフォールバックは `/verify` の「統合テスト」節に従う。

## 5. DDD レビュー・UI レビュー

`/ddd-review` を実行し(ddd-reviewer サブエージェントが main との diff をレビュー)、must-fix と suggestion を修正したら再度 `/verify` を回す。suggestion は原則この場で対応し、見送るのは `/ddd-review` の例外基準 (a)(独立した PR が必要な別リファクタリング相当の規模)または (b)(ユーザーの意思決定が必要な設計判断)に該当する場合のみ。**Issue 化するのは (b) のみ**で、(a) は PR 本文のレビュー結果節に見送った内容と理由を記録する(同じ指摘が複数の PR で繰り返し見送られた場合に限り Issue 化してよい)。

`packages/web` 配下に変更がある場合は、`/ddd-review` に加えて `/ui-review` も実施する(ui-reviewer サブエージェントが `DESIGN.md` とプレゼンテーション層の観点でレビュー)。指摘の扱いは `/ddd-review` と同じ(must-fix は必須修正、suggestion も原則その場で対応、見送りは例外基準 (a)(b) に該当する場合のみで、Issue 化は (b) のみ)。

## 6. 受け入れシナリオ(`docs/acceptance/`)との照合

実装が完了したら、PR を作る前に `docs/acceptance/` の受入シナリオとの対応を確認する。Issue 単位の受け入れ条件は `/verify` が見るが、それが本番で人間が確認するどのシナリオに当たるかは誰も追っていない。ここで対応付けておくと、受入テスト実施時に「今回の変更でどのシナリオを再実施すべきか」が PR から辿れる。

差分がドキュメント・開発プロセスのファイル(`docs/**`・`.claude/**`・`.github/**`)だけで、**アプリの振る舞いがまったく変わらない**場合は本手順を省略してよい。省略したときは PR 本文の「受け入れシナリオ(AT)」節にその旨を1行書く。

1. **該当シナリオを探す**。`docs/acceptance/README.md` §4 の ID 規約と §7 のマスタチェックリストで領域を絞り、該当ファイル(`01-smoke.md`〜`07-masters.md`、および保留の `90-pending.md`)の手順表と期待結果を読む。判定は「**そのシナリオを実施したとき、今回の変更が期待結果に現れるか**」で行う(ファイル名やキーワードの一致では判定しない)

2. 結果で分岐する:

   | 状況                         | 対応                                                                                                                                                      |
   | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | 該当シナリオがある           | PR 本文の「受け入れシナリオ(AT)」節に AT 番号と、どの期待結果に対応するかを書く。シナリオの手順・期待結果が変わらないなら `docs/acceptance/` は変更しない |
   | 該当シナリオが無い           | 下の「該当シナリオが無い場合」に従う                                                                                                                      |
   | 既存シナリオが成立しなくなる | 下の「既存シナリオを壊す変更の場合」に従う                                                                                                                |

3. 照合の結果を PR 本文の「受け入れシナリオ(AT)」節に書く(`templates/pr-body.md` / `.github/PULL_REQUEST_TEMPLATE.md`)。該当なしと判断した場合も、その旨と理由を1行書く

### 該当シナリオが無い場合

ユーザーに見える振る舞いを追加・変更したのに、それを確認するシナリオが `docs/acceptance/` に無いとき。**シナリオを追加するか、不要と判断するかを必ずどちらか選び、選んだ結果を PR 本文に書く**(黙って何もしない選択肢は無い)。

**シナリオを追加する**(既定。本番の実機・実データでしか確認できない振る舞いを足したとき):

- `docs/acceptance/README.md` §4 の ID 規約で領域を決め、該当ファイル(01〜07)の末尾に既存シナリオと同じ書式(目的 / 対象 / 実施者 / 前提条件 / 手順表 / 事後処理 / 実施記録)で追加する。ID は同領域の最大番号 + 1 を採る
- `README.md` §7 のマスタチェックリストにも行を追加する(判定・実施日は空欄のまま)
- 未実装機能に依存して**まだ実施できない**シナリオは `90-pending.md` の AT-9xx に書き、ブロッカーと昇格先を明記する。リリースゲートの表(§7)には載せない

**不要と判断する**(次のいずれかに当たるとき。理由を PR 本文に書く):

- 本番構成でしか確認できない要素が無く、自動テスト(単体 / 統合 / VRT / `e2e` の受入 E2E)で完結する内部的な変更
- 開発プロセス・CI・docs だけの変更で、ユーザーに見える振る舞いが変わらない
- 既存シナリオの期待結果にすでに含まれており、手順を足す必要がない

### 既存シナリオを壊す変更の場合

既存シナリオの手順・期待結果が今回の変更で成立しなくなるとき(画面名や操作導線が変わる、期待する表示が変わる、前提条件を満たせなくなる 等)。**実装とシナリオのどちらが正か**で対応が分かれる。

- **実装が正しい(仕様変更として意図したもの)** → `docs/acceptance/` を**同じ PR で更新する**。実装だけ変えてシナリオを古いまま残さない(受入テストで NG と誤判定され、原因調査に時間を取られる)。更新は手順表の該当行に絞り、**実施記録の表は消さない**(過去の実施履歴は監査の記録)。更新した AT 番号と変更内容を PR 本文に書く
- **シナリオが正しい(実装が仕様から外れている)** → `docs/acceptance/` は書き換えず、**実装を直す**。壊れたシナリオに合わせてドキュメントを書き換えると、仕様逸脱がそのまま仕様になる
- **どちらが正か判断がつかない** → 判断を人間に委ねる。対話モードではユーザーに確認し、無人モードは後述の差分に従う
- 壊れたシナリオが `README.md` §8 の自動化済み一覧に載っている場合は、対応する `e2e/` の Playwright テストも同じ PR で追随させる(CI が赤くなってから直すのではなく、先に直す)

## 7. PR 作成と CI ループ(外側ループ)

1. 受け入れ条件のチェックボックスを満たしているか、手順6の照合結果を PR 本文の「受け入れシナリオ(AT)」節に書けるかを最終確認する
2. **`packages/web` に変更がある場合**、変更に関係する画面を darling / honey 両テーマで撮影し、PR 本文に含める(下記「UI 変更時のスクリーンショット添付」)。撮影の失敗は PR 作成を止める理由にしない
3. `git push -u origin HEAD`
4. `gh pr create` — PR テンプレートに従い、本文に `Closes #<番号>` を含める。本文は必ず**ファイル経由**(`--body-file <ファイル>` または heredoc)で渡す。`--body "...\n..."` のようにエスケープ文字入りの1行文字列で渡すと、シェルは `\n` を改行に展開せずリテラルのまま本文に残す。GitHub MCP(`create_pull_request`)の場合も、`body` には実際の改行文字を含む文字列を渡す(`\n` の2文字を埋め込まない)
5. **リンク検証**: PR 作成直後に、Issue との auto-close リンクが張られたことを確認する
   - `gh pr view <PR番号> --json closingIssuesReferences` の結果に対象 Issue 番号が含まれること
   - `gh` が使えない環境では、PR 本文を再取得(`pull_request_read`)し、本文にリテラル `\n` が含まれず、`Closes #<番号>` が行頭(または空白直後)にあることを確認する
   - リンクが無ければ本文を修正して再確認する。**必ずマージ前に行う**(マージ前の本文修正ならリンクは張り直せるが、マージ後に修正しても auto-close は遡って発動しない。2026-07-24 の #136 はこの検証が無かったため、リテラル `\n` 入り本文の PR #182 がマージされても Issue が open のまま残った)
6. CI の結果を確認する: `gh pr checks --watch`
7. CI が失敗したら `gh run view <run-id> --log-failed` で原因を取得し、修正 → `/verify` → push を CI が green になるまで繰り返す

PR が green になったら、PR の URL と受け入れ条件の充足状況をユーザーに報告して完了。

補足: PR マージで Issue は自動クローズされる(`Closes #<番号>`)。マージまで見届ける場合は `gh issue edit <番号> --remove-label "status:in-progress"` でラベルを外す。クローズ済み Issue にラベルが残っていても実害はない。

### UI 変更時のスクリーンショット添付(`packages/web` に変更がある場合)

`packages/web` 配下に変更がある PR は、コード diff だけでは見た目を判断できない。読む人がコードを読まずに見た目を確認できるよう(無人モードでは自動マージ後の事後確認の材料になる)、変更に関係する画面を darling / honey 両テーマで撮影し、PR 本文に添付する(モック起動基盤 #141 を利用)。対話モード・無人モードとも実施する。

**撮影の失敗は撤退・PR 見送りの理由にしない**(後述)。

1. **web 変更の有無を判定する**。空なら本節をスキップする:

   ```bash
   git diff --name-only origin/main...HEAD -- packages/web/
   ```

2. **撮影対象の画面を特定する**。変更したルート(`src/app/<route>/`)に対応する画面を選ぶ(例: `src/app/transactions/` を触ったら `/transactions`)。判別がつかなければダッシュボード `/` を撮る。

   > モック fixture が用意された画面のみ実データで描画される(現状はダッシュボード関連のみ。`src/mocks/` を参照)。fixture 未整備の画面はエラー状態で描画される。撮影対象の fixture が無ければ、その旨を PR 本文のスクリーンショット節に1行記す(fixture の追加は本節の責務ではない)。

3. **両テーマで撮影する**。テーマは URL クエリで切り替わる(既定 darling): `?mockRole=darling` / `?mockRole=honey`。撮影スクリプトはスクラッチディレクトリに置き、リポジトリにはコミットしない。実行環境にプリインストール済みの Chromium を使う Playwright で撮る:
   - モックサーバを起動(バックグラウンド、ポート 3000): `pnpm --filter @warimaru/web dev:mock`
   - サーバ応答を待ってから、対象画面 × 両テーマの URL(例: `http://localhost:3000/transactions?mockRole=honey`)を開き、`page.screenshot()` で PNG に保存する
   - 撮り終えたらモックサーバを停止する

4. **PR 本文から参照できる形にして添付する**。GitHub の PR 本文はテキストのみで、画像は本来**リポジトリにコミット済みのファイルの URL 参照**で埋め込める。ただし**GitHub MCP(`create_pull_request` 等)経由で本文を書き込むと、保存時に本文中の URL が必ずエスケープされ、画像として描画されない**(#560。貼り方の問題ではなく書き込み経路そのものに起因するため、URL の書式を変えても回避できない)。次の方法で添付する:
   - 撮影した PNG を PR ブランチにコミットする。置き場: `docs/pr-screenshots/issue-<番号>/<screen>-<theme>.png`
   - PR 本文には画像を埋め込まず、コミットしたファイル名の一覧を書く(読む人は PR の Files changed から直接開く)
   - `templates/pr-body.md` の「画面(スクリーンショット)」節のフォーマットに従って並べる。既存画面の見た目を変える変更では、可能なら変更前(`origin/main` を撮影)も併記する

   > これらの PNG は見た目を確認するための添付物であり、マージすると `docs/pr-screenshots/` に残る。マージ/クローズ済み PR の分は `/pr-steward` が削除 PR を作って掃除する(手動で削除してもよい。削除しても機能に影響しない)。

5. **撮影に失敗した場合**(モックサーバ起動不可・ブラウザ不可・fixture 不足など): 添付なしで PR 作成を続行し、PR 本文のスクリーンショット節に「撮影できなかった(理由: …)」と1行記す。無人モードでも同じ扱いで、撮影失敗を撤退・スキップの理由にしない。

### VRT スナップショットの更新（意図した UI 変更の場合）

`packages/web` の見た目を変える Issue では、ビジュアルリグレッションテスト（VRT: `pnpm --filter @warimaru/web test:e2e`）が既存スナップショットとの差分を検出して赤になる。この赤は原因に応じて対処が分かれる:

1. **受け入れ条件どおりの意図した見た目の変更** → スナップショットを更新してコミットする:

   ```bash
   pnpm --filter @warimaru/web test:e2e --update-snapshots
   git add packages/web/e2e/__screenshots__/
   ```

   更新後に再度 `pnpm --filter @warimaru/web test:e2e` を実行し、green を確認する

2. **意図しない差分**（実装ミスやスタイルの副作用） → スナップショットは更新せず、実装を修正する

スナップショットを更新した PR では以下を守る:

- **「UI 変更時のスクリーンショット添付」が必須**: 更新されたスナップショットだけでは見た目の妥当性を判断できない。darling / honey 両テーマのスクリーンショットを PR の読み手が確認できるよう、上記の手順に従って PR 本文に添付する
- **PR 本文にスナップショットを更新した旨と理由を記す**: `templates/pr-body.md` の「画面（スクリーンショット）」節に、更新した画面名と理由（「受け入れ条件に基づく意図した UI 変更」等）を書く

## 無人モード(Routine からの自動起動)

Routine のセットアップ手順は `docs/automation/backlog-routine.md`、ラベルの定義と状態遷移は `docs/workflow/02-labels.md` を参照。無人モードでは以下の差分を適用する。**1回の起動で作成する PR は最大1つ**。PR 作成に成功したらその fire は完了する。ただし、候補の撤退・スキップが発生した場合は次の候補へ進み、1件 PR 作成に到達するまで試行する(候補ループ。手順0「候補選定と排他ロック」参照)。

### 原則: 人間の判断は Issue に集約する

無人モードでユーザーの判断が必要になったら、種類を問わず **`needs-decision` ラベル付きの Issue** に集約する(チャットの最終報告や PR 本文だけに書いて済ませない)。判断が必要な事象は2種:

1. **撤退時の確認**(受け入れ条件が曖昧・設計判断が分かれる・CI が直せない・マージゲートに落ちた) → 元 Issue に判断依頼コメント + `needs-decision`(既存 Issue のタイトルは変えないため種別目印は付けない)
2. **見送り追認**(レビュー suggestion の見送りのうち、各レビュー skill の例外基準 (b) — ユーザーの意思決定が必要な設計判断 — に該当するもの) → 新規 Issue + `needs-decision`(タイトル先頭に `[判断待ち]`)。基準 (a)(別リファクタリング相当の規模)による見送りは **Issue を起票せず**、PR 本文のレビュー結果節への記録のみとする

マージ判断はこの集約対象ではない。ゲート(後述「マージゲート」)を満たす PR は無人モードがそのままマージし、ゲートに落ちた PR だけが 1.(撤退時の確認)として人間に上がる。

これによりユーザーは `is:issue is:open label:needs-decision` の一覧だけで判断すべきことを全量把握でき、ラベル付与をトリガーに通知ワークフロー(`.github/workflows/notify-needs-decision.yml`)がメール通知を発生させる。**新規に起票する判断待ち Issue はタイトル先頭に種別目印**(`[判断待ち]` / `[乖離報告]` / `[改善案]`)**を付ける**(メール件名での種別識別と @メンション文面の出し分けに使う。目印の一覧は `templates/judgment-issue.md`「タイトルの種別目印」を正とする)。

判断依頼・PR の本文を書く前に、**必ず対応するテンプレート(`templates/judgment-issue.md` / `templates/pr-body.md`)を読み**、そのフォーマットで書く。

### 人間向け報告の執筆ルール

判断依頼 Issue・コメント・PR 本文など、人間が読む出力すべてに適用する:

- 読み手はこのセッションの経緯を**一切見ていない**前提で書く。前置きなしにセッション中の出来事や検討過程へ言及しない
- 冒頭に「何の機能の話か」をアプリを使う人の言葉で1〜3行書く(技術構成ではなく「使う人に何が起きるか」で説明する)
- 判断依頼は「質問1文(疑問文)→ 選択肢 → 各選択肢を選んだ場合の影響」の順で書く
- 専門用語・略語には初出時に括弧で平易な説明を添える(例: 「fail-open(異常時にチェックを素通しにしてしまう状態)」)
- 結論・質問を先頭に置き、技術詳細は後ろに回す。体言止めや用語の羅列を避け、主語と述語のある文で書く
- 量より選別。判断に影響しない詳細は書かない

### マージゲート

無人モードは PR を作って終わりにせず、**ゲートを満たした PR を自分でマージする**。人間の承認ゲートは Issue への `ready-to-implement` 付与(着手承認)に前倒しで集約されており、マージは以下の機械的判定に置き換わっている。

このゲートは**マージ手順の唯一の定義**である。`/pr-steward` はマージを行わない(判定を二重に持たないため)。ゲートを使う場所は2つ:

- **手順0の回収マージ** — 前の fire が残した Routine 起点 open PR(後述 preflight)
- **手順7** — この fire が作った PR

#### ゲート条件

以下を**すべて**、コマンド出力で機械的に確定させる。**自然言語の判断で条件を緩めてはならない**(ゴミロック回収と同じ規律)。1つでも満たさなければマージせず、理由を最終報告に記す。

1. **Routine 起点の PR である** — 次のいずれかを満たす(この列挙が判別基準の正。`/pr-steward` と `/retro` もこれを参照する): PR 本文に「無人モードの選定理由」節が含まれている / head ブランチが `feat/issue-N-` で始まる / head ブランチが `claude/issue-N-` で始まる / head ブランチが `chore/cleanup-pr-screenshots` で始まる(`/pr-steward` のスクリーンショット残骸削除 PR)/ head ブランチが `revert/main-failure-` で始まる(`notify-main-failure` の自動 revert PR。#739)。**判別できない PR・人間が手動作成した PR・`/decide` の docs PR には触れない**
2. **`needs-decision` が PR にも対象 Issue にも付いていない** — このラベルが個別 PR の停止スイッチを兼ねる(専用ラベルは作らない)。人間がマージを止めたい PR には `needs-decision` を付ければよい
3. **コンフリクトしていない** — `mergeable == MERGEABLE`(`gh` / GraphQL)または `mergeable_state == clean`(REST / MCP)。`unknown`(計算中)は2〜3秒間隔で最大3回再照会し、確定しなければマージを見送る
4. **head commit の `verify` が success** — `.github/workflows/ci.yml` の `verify` はブランチ保護の必須チェックであり、これがマージ可否の判定そのもの。**完了するまで待つ**(pending をマージ可とみなさない)。
   `pr-preview` のチェック(`publish` / `deploy` / `comment`)は**マージを止めない**: 配信は画面確認の補助であって検証の関門ではなく(ワークフロー側も `continue-on-error` でそう扱っている)、`concurrency: pr-preview` でリポジトリ全体が直列化されるため長く pending しうる。待たず、failure でもマージするが、failure だった事実は最終報告に記す
5. **レビューがマージを止めていない** — `CHANGES_REQUESTED` のレビュー・未解決のレビュースレッドが無い
6. **PR 本文の `Closes #<番号>` が生きている** — 行頭に番号付きで存在し、本文(API の生データ)にリテラルの `\n`(バックスラッシュ + n の2文字)を含まない。**マージ後に本文を直しても auto-close は遡って発動しない**ため、異常があれば先に本文を修正 push し、修正後に再判定する(手順は `/pr-steward` 手順 2a-2 と同じ)
7. **対象 Issue が open で `ready-to-implement` が付いている** — 着手承認が生きていることの確認。スクリーンショット削除 PR のように対象 Issue を持たない PR はこの条件を適用しない

#### マージの実行

```bash
gh pr merge <PR番号> --squash --delete-branch
```

GitHub MCP の場合は `merge_pull_request`(`merge_method: squash`)で行い、head ブランチを削除する。マージ方式はリポジトリの既定(squash)に合わせる。

#### 同一 fire で2件目以降をマージする場合

直前のマージで `main` が進んでいるため、**別々のファイルを触っていても意味の上で衝突する変更(semantic conflict)** をそのままマージすると `main` が壊れる。同一 fire で既に1件マージしている場合、次の PR は必ず追従させてから判定する:

```bash
git fetch origin <PRのheadブランチ> && git switch <PRのheadブランチ>
git fetch origin main && git merge origin/main
```

`/verify` を全 green にして push し、**CI が再度 green になるのを確認してから**ゲート条件4を判定する。追従後の CI が赤ければマージせず、CI 修復ループ(手順7「完了」の定義)に載せる。この `git merge origin/main` でコンフリクトが出た場合は「コンフリクト修復 preflight」と同じ手順で解消する(判断が必要な競合なら解消せず `needs-decision` で人間に委ねる)。

追従には CI 1周ぶんの待ちが発生する。セッション寿命が尽きて待ち切れない場合はマージせずに終え、その PR は次の fire の回収マージ(そこでは1件目なので追従不要)に委ねる。

#### マージ後の確認

マージしたら `main` への push で走る CI(`.github/workflows/ci.yml` の `verify`)の完了を確認する。**赤くなったらその fire ではそれ以上マージしない**(残りの回収マージを中止し、何をマージして何が失敗したかを最終報告に記す)。`main` が赤いままだと以降の全 PR が同じ失敗で赤くなるため、巻き添えを止めることを優先する。`main` の赤の起票は `notify-main-failure` ジョブ(`needs-decision` 付きの Issue を作成)が行うので、無人モード側で別途起票はしない。

### 手順0の代替: 着手判定

候補選定から排他ロックまでの全手順。スコープ B に従い、撤退・スキップ時は次候補へ進む(後述「候補ループ」)。

#### preflight — `main` の健全性チェック

すべてに先立って、`main` の最新の CI が green かを確認する:

```bash
gh run list --branch main --workflow ci.yml --limit 1 --json conclusion,headSha,url
```

**`conclusion` が `failure` なら、この fire は何もしないで終了する**(ゴミロック回収も回収マージも新規着手も行わない。実行中なら完了を待つか、待てなければ「main の CI 実行中のため見送り」と報告して終了する)。CI は「`main` と合体させた状態」を検証するため、`main` が赤いままだと以降の全 PR が同じ失敗で赤くなる。赤い `main` の上に PR を積み増さず、巻き添えを止めることを優先する。

`main` の赤は `notify-main-failure` ジョブが `needs-decision` 付きの Issue で人間に上げている。最終報告にはその Issue 番号(または failure の run URL)を添える。

#### preflight — ゴミロックの機械的回収(self-heal)

候補選定の前に、fire の異常終了や PR のクローズで放置された着手中ロックを回収する。これを怠ると、`ready-to-implement` な Issue すべてに死んだ `status:in-progress` が残り、候補が 0 件になって**毎 fire スキップし続ける**(バックログが止まる)。

回収判定は**機械的に**行う。自然言語の判断で条件を緩めてはならない(2026-07-24 の二重着手事故は、ロック付与10分・open PR ありの状況で条件を無視して回収したことが直接原因)。

1. `status:in-progress` が付いた open Issue を列挙する
2. 各 Issue について、次の2条件を**コマンド出力で**確定させる:

   **条件1 — 紐づく open な PR が無い**:
   - Issue 番号 `N` に対し、close キーワード集合(下記)+ `#N` を含む open PR を検索する(GitHub MCP: `search_pull_requests` で `repo:<owner>/<repo> is:pr is:open "Closes #N"` 等、または `list_pull_requests` で open PR の body を確認)
   - さらに head ブランチが `feat/issue-N-` **または** `claude/issue-N-` で始まる open PR を検索する(リモートセッション起点の fire は `claude/issue-<番号>-<suffix>` 形式のブランチを作るため、`feat/` だけでは Routine 作成 PR を取りこぼす)
   - **いずれかの検索で open PR が1件でも見つかったら、その Issue のロックは回収しない**(実装中の生きた fire が存在する可能性がある)

   > **close キーワード集合(正規定義)**: `close` / `closes` / `closed` / `fix` / `fixes` / `fixed` / `resolve` / `resolves` / `resolved` + `#N`(大文字小文字を区別しない)。`.github/workflows/notify-needs-decision.yml` の抽出正規表現と同一の集合。本スキルおよび `/pr-steward` 内の重複 PR 検索は、すべてこの集合を使う(テンプレート `templates/pr-body.md` は `Closes #N` を規定しているが、手動 PR の表記ゆれも拾うため検索側は全集合で行う)

   **条件2 — ロックが古い(付与から2時間以上経過)**:
   - Issue のイベントタイムライン(GitHub MCP: `issue_read` method `get` で `updated_at` を確認、またはイベント API で `labeled` イベントの `created_at` を取得)から `status:in-progress` の付与時刻を特定する
   - 付与時刻が現在から**2時間未満**なら、その Issue のロックは回収しない(並行 fire が実装中の可能性がある)
   - 付与時刻を特定できない場合は安全側に倒し、回収しない

3. **両方の条件を満たす** Issue からのみ `status:in-progress` を外す(他ラベルは触らない)
4. 回収した Issue 番号は最終報告に含める

回収した Issue はそのまま下の候補選定で拾い直せる(`ready-to-implement` が残っていれば対象に戻る)。PR を**未マージでクローズ**したことによるロック残りは `.github/workflows/notify-needs-decision.yml` が即時に解除するため、この preflight はおもに「PR を作らずに死んだ fire」の取りこぼしを拾う保険となる。

#### コンフリクト修復 — Routine 起点 open PR の先解消

ゴミロック回収に続けて、**新規着手の前に** Routine 起点の open PR がコンフリクト(base の `main` と PR の変更が衝突して自動マージできない状態)に陥っていないかを機械的に確認し、あれば**先に解消してから**候補選定へ進む。これを怠ると、コンフリクトした PR が次に人間が気づくまで放置され、その間に新しい PR を積み増して衝突を広げてしまう(2026-07-24 の PR #191)。修復役の `/pr-steward` は別スケジュールのため、確実に毎 fire 動くこの preflight で「壊れた PR を放置したまま新しい PR を増やさない」順序を担保する。

1. open PR を mergeable 状態つきで列挙する。GitHub の mergeable は**照会されて初めて計算が始まり**、直後は `unknown`(計算中)が返るため、`unknown` の PR は数秒待って再照会する(2〜3秒間隔で最大3回程度):
   - GitHub MCP: `list_pull_requests` で open PR を取得したうえで、PR ごとに `pull_request_read` method `get` を呼び `mergeable` / `mergeable_state` を確認する(一覧 API には mergeable が含まれない)
   - `gh`: `gh pr list --state open --json number,mergeable,headRefName,body`
2. Routine 起点の PR に絞る(判別基準は上の「マージゲート」条件1と同一: 本文に「無人モードの選定理由」節がある / head ブランチが `feat/issue-N-`・`claude/issue-N-`・`chore/cleanup-pr-screenshots` で始まる)。人間が手動作成した PR には触れない
3. `mergeable == CONFLICTING`(`gh` / GraphQL)または `mergeable_state == dirty`(REST / MCP)の PR があれば、候補選定より先に解消する。手順は `/pr-steward` 手順2c と同じ:
   ```bash
   git fetch origin <PRのheadブランチ> && git switch <PRのheadブランチ>
   git fetch origin main && git merge origin/main
   # コンフリクトを解消する。ドメインロジックの競合など判断が必要な場合は解消せず、
   # その PR と対象 Issue に needs-decision を付けて人間に委ね、次へ進む
   ```
   解消したら `/verify` を全 green にしてから push する(この時点ではマージしない。マージ可否は次の「回収マージ」でゲート判定する)
4. **push が non-fast-forward で拒否された場合**(別セッション — `/pr-steward` など — が同じ PR ブランチをほぼ同時に修復した競合。コンフリクト解消はこの preflight と `/pr-steward` の2か所が担うため起こりうる): `git fetch origin <PRのheadブランチ>` でリモートを取り直し、mergeable を再確認する。**既に解消済み**(`mergeable == MERGEABLE` / `mergeable_state == clean`。別セッションが先に修復した)なら自分の解消は不要なので、何もせず次へ進む。**まだコンフリクトが残る**場合のみ、取り直した head に base を再度マージして解消し **1回だけ** push をやり直す。それでも拒否されたら、その PR の解消は保留して最終報告に記し、次へ進む(同じ競合で押し合いを続けない)
5. `unknown` のまま確定しない PR はコンフリクト判定を保留し、解消・needs-decision 化した PR とあわせて最終報告に含める。コンフリクトが無ければ何もしない

この修復で fire の所要時間は延びうるが、放置時間の上限が最長で fire 間隔（Routine の登録数とスケジュールに依存）に収まる。**WIP 上限超過で新規着手をスキップする場合でも、コンフリクト修復は実施する**(壊れた PR の放置を防ぐため、本 preflight は下の WIP 上限チェックより前に置く)。

#### 回収マージ — 前の fire が残した PR をマージする

コンフリクト修復に続けて、**新規着手の前に** Routine 起点の open PR を「マージゲート」で判定し、満たすものをマージする。自分が作った PR は手順7でその fire 内にマージするが、次のケースでは PR が open のまま残るため、ここで回収する:

- fire のセッション寿命が尽きて CI を待ち切れなかった
- `/pr-steward` が後から CI 失敗を修復して green にした
- `/pr-steward` がスクリーンショット残骸の削除 PR を作った(`/pr-steward` はマージしない)

手順:

1. コンフリクト修復で列挙済みの Routine 起点 open PR(判別基準はマージゲート条件1。スクリーンショット削除 PR を含む)を対象にする
2. 各 PR を**マージゲート**で判定し、満たすものをマージする。2件目以降は追従ルール(`main` を取り込んで CI 再 green を確認)に従う
3. マージ後に `main` の CI が赤くなったら、その fire では**以降のマージを一切行わない**(新規着手も行わず、状況を報告して終了する。赤い `main` の上に PR を積み増さない)
4. ゲートに落ちた PR はマージせず、落ちた条件を最終報告に記す。CI が赤い PR は `/pr-steward` の修復対象なのでここでは触らない(コンフリクトだけは上の修復手順で解消済み)

回収マージは WIP 上限チェックより前に置く。マージで open PR が減れば上限が解放され、同じ fire で新規着手へ進めるため。

#### WIP 上限チェック

open な PR のうち **Routine 起点(無人モード)で作成されたもの**だけを数える。人間の手動 PR や `/decide` の docs PR はカウントしない:

```bash
gh pr list --state open --json number,headRefName,body
```

Routine 起点の判別基準(上の「マージゲート」条件1と同一): PR 本文に「無人モードの選定理由」セクションが含まれている、または head ブランチが `feat/issue-N-`・`claude/issue-N-`・`chore/cleanup-pr-screenshots` で始まる。判別できないものは対象外(カウントしない)。

GitHub MCP の場合は `list_pull_requests` で open PR を取得し、各 PR の `headRefName` と `body` で判別する。

**Routine 起点の PR が5件以上**なら新規着手せず、「WIP 上限のためスキップ」と報告して終了する(レビュー待ち PR が溜まった状態で着手を重ねると、PR 同士のコンフリクトと依存切れを招くため)。

#### 候補選定と排他ロック(候補ループ)

`gh issue list --state open --label "ready-to-implement" --json number,title,labels,assignees,body,createdAt` から候補リストを取得し、以下をすべて満たす Issue を優先順に並べる:

- `status:in-progress` / `needs-decision` ラベルが付いていない
- 誰にも assign されていない
- 本文の「依存」「先行」節に挙げられた先行 Issue がすべてクローズ済み(open のものに依存していない)。ただし `state_reason: not_planned` でクローズされた先行 Issue は「依存解決」とみなさない(後述の not_planned ガード参照)。「関連」「参考資料」内の Issue 参照は着手ブロック条件にしない(単なる参照)。依存待ちの ready Issue は正常な状態であり、条件を満たすまでスキップして次候補を見る

優先順は `priority:high` → 作成が古い順。

候補リストを先頭から順に試し、**1件 PR 作成に成功するか、候補を使い切るまで**ループする(最大試行数: **5件**。無限ループの歯止め):

1. **排他ロック(CAS)**: ロック付与の直前に Issue のラベル一覧を再取得し、`status:in-progress` が**既に付いていたら**その候補をスキップして次へ(並行 fire が先にロックした)。付いていなければ直ちに `status:in-progress` を付与する
2. **重複 PR ガード**: ロック取得後、手順1(Issue 理解)に入る前に、その Issue 番号 `N` に対して close キーワード集合(preflight 条件1参照)+ `#N` を含む **open または merged な PR** を検索し、結果で分岐する:
   - **open PR が見つかった** → `status:in-progress` を外してその候補をスキップし次へ(並行 fire が実装中)。スキップ理由は最終報告に含める
   - **merged PR が見つかった**(実装済みの PR がマージ済みなのに Issue が open のまま残っている異常状態) → `status:in-progress` と `ready-to-implement` を外し、元 Issue に `needs-decision` を付けて判断依頼コメント(`templates/judgment-issue.md` に従い、Issue をクローズしてよいか・残作業があるかの判断を依頼)を残して次候補へ。単にスキップするだけだと毎 fire 再検査・再スキップされて候補ループの枠を浪費し続けるため、人間に可視化して状態を解消する
3. **not_planned ガード**: 候補の本文の「依存」「先行」節に挙げられた先行 Issue のうち、`state_reason: not_planned`(実装しないと判断された)でクローズされたものがあれば、前提機能が存在しないまま着手することになる。`status:in-progress` と `ready-to-implement` を外し、元 Issue に `needs-decision` を付けて判断依頼コメント(`templates/judgment-issue.md` に従い、前提の Issue が実装されないことになったがこの Issue を進めてよいか・受け入れ条件の見直しが必要かの判断を依頼)を残して次候補へ進む
4. すべてのガードを通過したら、手順1へ進む
5. 手順1・5で撤退した場合も、ロックを解除して次候補へ進む(スコープ B)

候補が1件もないか、全候補をスキップ/撤退して使い切った場合は「着手可能な Issue なし」と報告して終了する。選定理由はユーザーに確認せず、最終報告に含める

### 手順1・5の差分: 確認の代わりに判断依頼を残して撤退

- 受け入れ条件が曖昧、または設計判断が分かれる場合は**実装しない**。`templates/judgment-issue.md` のフォーマットで判断依頼を元 Issue にコメントし、ラベルを付け替えて**候補ループの次候補へ進む**:
  ```bash
  gh issue comment <番号> --body "<templates/judgment-issue.md に従った判断依頼>"
  gh label create "needs-decision" --color D93F0B --description "人間の判断待ち" 2>/dev/null || true
  gh issue edit <番号> --add-label "needs-decision" --remove-label "ready-to-implement" --remove-label "status:in-progress"
  ```
  (`needs-decision` はユーザーが回答して `needs-decision` を外し `ready-to-implement` を付け直すまで無人モードの対象外になる)
  撤退してもその fire は終了せず、候補ループの次の Issue へ進む。これにより、1件の撤退で fire 全体が空振りする事態を防ぐ
- レビュー suggestion の見送りのうち、例外基準 (b)(ユーザーの意思決定が必要な設計判断)に該当するものだけを Issue 化する。その Issue はタイトル先頭に `[判断待ち]` を付け、本文は `templates/judgment-issue.md` のフォーマットで書き、`needs-decision` を付与したうえで、PR 本文の「あなたに判断してほしいこと」からリンクする。基準 (a)(別リファクタリング相当の規模)による見送りは Issue を起票せず、PR 本文のレビュー結果節に記録する

### 手順4の差分: /verify 行き詰まり時の撤退

`/verify` のループ打ち切り(同一エラーで3回連続失敗)に達した場合、無人モードには報告先の人間がいない。ロックの解除も判断依頼の記録も無いまま fire が終わる silent failure を防ぐため、以下の撤退手順を適用する:

1. 元 Issue に `templates/judgment-issue.md` のフォーマットで判断依頼コメントを残す(何のステップが・どんなエラーで失敗し・何を試したかを記す)
2. ラベルを付け替える:
   ```bash
   gh label create "needs-decision" --color D93F0B --description "人間の判断待ち" 2>/dev/null || true
   gh issue edit <番号> --add-label "needs-decision" --remove-label "ready-to-implement" --remove-label "status:in-progress"
   ```
3. 作成済みのローカルブランチは残す(push はしない)
4. 実装コストを二重に払わないため、候補ループには戻らず fire を終了する(push 前重複ガードの撤退と同じ扱い)

### 手順6の差分: 受入シナリオの照合で判断がつかない場合

手順6の照合そのもの(該当シナリオの特定・シナリオの追加・実装に合わせたシナリオの更新)は、無人モードでも通常どおり行う。書式が既存シナリオに揃っていれば機械的に書けるため、無人であることを理由に省略しない。

判断が要るのは次の2つで、いずれも **PR 作成は止めずに** `[判断待ち]` Issue へ切り出す(照合を理由に撤退しない。撤退すると実装済みの差分が失われる):

- 既存シナリオが成立しなくなったが、**実装とシナリオのどちらが正か決められない**
- 追加すべきシナリオの範囲が大きい、または領域そのものが未定義で、`docs/acceptance/README.md` §4 の ID 規約に収まらない

切り出し方は「手順1・5の差分」の見送り追認と同じで、タイトル先頭に `[判断待ち]` を付け、本文は `templates/judgment-issue.md` のフォーマットで書き、`needs-decision` を付与したうえで PR 本文の「あなたに判断してほしいこと」からリンクする。

### 手順7の差分: PR 作成・CI green の確認・マージ

- **push / PR 作成直前の重複ガード**: `git push` の直前に、対象 Issue 番号 `N` に対して close キーワード集合(手順0 preflight 条件1参照)+ `#N` を含む **open または merged な PR** を再検索する(手順0のガードと同じ検索だが、実装中に並行 fire が先に PR を作った場合を捕捉する最終防衛線)。**1件でも見つかったら push せず撤退する**。`status:in-progress` を外し、作成済みのローカルブランチは残す(次の手動対応に備える)。撤退の記録は**元 Issue へのコメント**に残す(先行 PR の番号と「並行 fire の PR が既に存在するため撤退した」旨を執筆ルールに従って書く)。実装コストを二重に払わないため、候補ループには戻らず fire を終了する
- PR 本文は `templates/pr-body.md` のフォーマットで書き、通常の PR(Draft ではない)として作成する。CI が green になったら、上の「マージゲート」で判定してマージする(下の「完了」の定義)
- **`packages/web` に変更がある場合**、push 前に手順7「UI 変更時のスクリーンショット添付」を実施し、darling / honey 両テーマの画面を PR 本文に添付する。自動マージ後にユーザーが見た目を事後確認する材料になるため、無人モードでは特に重要になる。ただし**撮影失敗は撤退・スキップの理由にしない**(添付なしで PR 作成を続行し、その旨を PR 本文に記す)
- PR 本文の `Closes #<番号>` は**必ず番号まで**書く(`Closes #` のまま残さない)。番号が無いと、重複 PR ガード・preflight 条件1・マージゲート条件6・`notify-needs-decision.yml` のロック自動解除のすべてからその PR が不可視になり、二重着手防止と Issue の auto-close が機能しない
- PR 作成直後に、対話モード手順7の**リンク検証**を必ず行う(本文の渡し方の注意も同じ: ファイル経由または実際の改行を含む文字列で渡し、リテラル `\n` を埋め込まない)。マージ後に本文を直しても auto-close は遡って発動しないため、この検証がマージ前の唯一の防衛線となる(マージゲート条件6でも再確認する)

#### 「完了」の定義: PR がマージされ、`main` の CI が green であること

**無人モードの1 fire は、PR 作成では終わらない。作成した PR の CI(`.github/workflows/ci.yml`)が green になり、マージゲートを満たしてマージされ、`main` の CI も green になって初めて完了とする。** ローカルの `/verify` が全 green でも、統合テストをローカルで実行できなかった場合(イメージ pull 不可のフォールバックも失敗した等)は、CI が初めて統合テストを走らせる。ここを確認せずに fire を終えると「ルーティンは完了・PR は CI 赤」の不整合が残り、以降の fire も拾わない(この不整合の再発防止が本手順の目的)。

1. PR 作成後、**同一 fire セッション内で CI の完了を待つ**。`gh pr checks <PR番号> --watch`(または GitHub MCP で checks/statuses をポーリング)で結果を得る。CI はネットワーク待ちを含むため、`sleep` で潰さず、チェック状態が確定するまで待機する
2. **green** なら、上の「マージゲート」で判定する:
   - ゲートを満たす → マージし、`main` の CI が green になることを確認する。PR の URL・マージした旨・受け入れ条件の充足状況・選定理由を最終報告して完了
   - ゲートに落ちた → マージせず、落ちた条件を元 Issue にコメントし `needs-decision` を付ける(撤退時の確認と同じ扱い)。PR は open のまま残し、次の fire の回収マージまたは `/decide` に委ねる
3. **赤**なら、対話モードと同じ修正ループに入る: `gh run view <run-id> --log-failed`(または MCP で失敗ジョブのログ取得)で原因を特定 → 修正 → `/verify`(統合テスト含む)→ 再 push を、CI が green になるまで同一 fire 内で繰り返す
4. **同一エラーで3回**修正に失敗したら、無限リトライを避けて撤退する。元 Issue に状況(何の CI ジョブが・どんなエラーで失敗し、何を試したか)を執筆ルールに従ってコメントして `needs-decision` を付け、その旨を最終報告して終了する(赤いまま PR は残るが、判断待ちとして人間に可視化される)
5. マージ後に **`main` の CI が赤くなった**場合は、その旨を最終報告に明記する(起票は `notify-main-failure` ジョブが行う)。以降のマージは行わない

補足(セッション寿命が尽きて CI を待ち切れない場合): fire が CI 完了前に終了する場合は、元 Issue に「CI 未確認のまま終了した(要 CI 確認)」旨を執筆ルールに従ってコメントする。この場合 `needs-decision` は付けない — CI が green になれば次の fire の**回収マージ**がそのまま拾い、赤ければ `/pr-steward` の修復対象になるため、人間の判断は不要。PR は通知ワークフロー(`notify-pr-opened`)でオーナーに assign 済みで可視化されている。**第一義は同一 fire 内での green 確認とマージ**であり、待ち切れは例外扱いとする。

### 手順8: fire 終了時の記録(tracking Issue への定型レコード)

`/retro` は撤退・CI リトライ・マージゲート落ちの記録を毎回 PR 本文・Issue コメントから発掘し直しており(基準6「可観測性」△の直接原因)、この手順はその発掘を「記録の集計」に変えるための記録元を残す。無人モードは fire を終える前に、その fire で起きた出来事を機械可読の記録として**固定の tracking Issue** に残す。手順0〜7のどこで fire を終えた場合(マージ完了・PR open のまま終了・撤退・候補なし/使い切りでのスキップ)でも、最後にこの手順を実行してから終了する。**上の各手順・各差分にある「撤退する」「次候補へ進む」「fire を終了する」という記述は、個別に手順8への言及がなくてもこの総則が適用される**(逐次的に読んでいて記録漏れが起きないよう、ここで一括して宣言する)。

1. **tracking Issue の特定(冪等)**: 本文にマーカー `<!-- fire-record-tracking -->` を含む open Issue を検索する(`gh issue list --search "fire-record-tracking" --state open --json number,body` で取得して本文にマーカー文字列があるものを選ぶ、または GitHub MCP `search_issues`)。**検索でヒットしなかった場合**(GitHub の検索インデックス反映遅延等)は、作成前に `notify-main-failure` ジョブ(`.github/workflows/ci.yml`)と同じ方式でフォールバックする: 全 open Issue を列挙し(`gh issue list --state open --json number,body` 等)、本文にマーカー文字列 `<!-- fire-record-tracking -->` を含むものをローカルで探す。それでも見つからない場合にのみ新規作成する(タイトル: `運用ログ: 無人モード fire の定型記録`。ラベルは付けない。ラベルの状態機械の対象外であり、`ready-to-implement` 等の3ラベルとは無関係)。この2段構えの探索は、検索の取りこぼしによる tracking Issue の複数化(記録の分裂)を防ぐためのもの。**この Issue はワークフローの永続的な記録装置であり、クローズしない**(本文にもその旨を明記して作成する)。

   <details>
   <summary>初回作成時の本文(そのまま使う。以後この本文がレコード形式の唯一の定義になる)</summary>

   ```markdown
   <!-- fire-record-tracking -->

   このIssueは無人モード(`/issue-work`・`/pr-steward`)の fire ごとの実行記録を溜める場所です。**閉じないでください**。

   ## レコード形式

   各コメントは、その fire で発生した出来事1件につき1行の JSON を持つ(1 fire = 1コメント。同じ fire 内で複数件の出来事があれば、同じコメント内に複数行の JSON を改行区切りで並べる。JSON Lines 形式)。

   | フィールド             | 型                      | 説明                                                                               |
   | ---------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
   | `kind`                 | string                  | `"issue-work"` \| `"pr-steward"`                                                   |
   | `at`                   | string                  | ISO 8601 UTC(例: `2026-08-27T12:00:00Z`。`date -u +%Y-%m-%dT%H:%M:%SZ`)            |
   | `issue`                | number \| null          | 対象 Issue 番号(Issue に紐付かない出来事は null)                                   |
   | `result`               | string                  | `"merged"` \| `"pr-open"` \| `"撤退"` \| `"スキップ"` \| `"空振り"`                |
   | `reason_code`          | string \| null          | 撤退・スキップの理由コード(下記コード表)。無ければ null                            |
   | `ci_retries`           | number                  | この出来事で行った CI 修正リトライ回数(無ければ 0)                                 |
   | `gate_fail_conditions` | array\<string\> \| null | マージゲートで落ちた条件番号(文字列)の配列(例: `["4","6"]`)。落ちていなければ null |
   | `filed_issues`         | array                   | この出来事の結果として起票した判断待ち Issue 番号の一覧(無ければ `[]`)             |

   ### `reason_code` コード表

   | コード                 | 意味                                                        |
   | ---------------------- | ----------------------------------------------------------- |
   | `ambiguous-acceptance` | 受け入れ条件が曖昧                                          |
   | `design-decision`      | 設計判断が分かれる                                          |
   | `verify-stuck`         | `/verify` が同一エラーで3回失敗                             |
   | `ci-stuck`             | CI 修正が同一エラーで3回失敗                                |
   | `duplicate-pr`         | 並行 fire の PR を検知(重複ガード)                          |
   | `merge-gate-fail`      | マージゲートのいずれかの条件に落ちた                        |
   | `conflict-undecidable` | コンフリクト解消の判断がつかない                            |
   | `no-candidate`         | 着手可能な候補がない、または候補ループ(最大5件)を使い切った |
   | `wip-limit`            | WIP 上限(Routine 起点 open PR 5件以上)のためスキップ        |
   | `main-red`             | `main` の CI が赤のため新規着手・マージを見送った           |
   | `at-review`            | 受入シナリオ照合(手順6)で判断がつかない                     |
   | `lock-race`            | 候補ループの CAS ロック取得で並行 fire に競り負けてスキップ |
   | `prereq-not-planned`   | 先行 Issue が `not_planned` でクローズされたための撤退      |
   | `other`                | 上記に当てはまらない(コメント本文の他の箇所に理由を書く)    |

   ### 例

   \`\`\`
   {"kind":"issue-work","at":"2026-08-27T12:00:00Z","issue":740,"result":"merged","reason_code":null,"ci_retries":0,"gate_fail_conditions":null,"filed_issues":[]}
   {"kind":"issue-work","at":"2026-08-27T12:00:05Z","issue":739,"result":"撤退","reason_code":"design-decision","ci_retries":0,"gate_fail_conditions":null,"filed_issues":[]}
   \`\`\`
   ```

   </details>

2. **レコードの投稿**: fire 内で発生した出来事(候補ループでのスキップ・撤退・PR 作成・マージ・マージゲート落ちなど)ごとに1行の JSON を組み立て、fire の終わりにまとめて1コメントとして tracking Issue へ投稿する(`gh issue comment <tracking Issue番号> --body <JSON Lines文字列>`、または GitHub MCP `add_issue_comment`)。候補なしで即終了した fire も `result: "空振り"` の1行を投稿する(空振り自体が基準10「資源効率」の測定対象のため、記録を省かない)。
