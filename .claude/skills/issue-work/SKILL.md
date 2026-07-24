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

## 5. DDD レビュー・UI レビュー

`/ddd-review` を実行し(ddd-reviewer サブエージェントが main との diff をレビュー)、must-fix と suggestion を修正したら再度 `/verify` を回す。suggestion は原則この場で対応し、見送るのは `/ddd-review` の例外基準に該当する場合のみ(その際は Issue 化して追跡する)。

`packages/web` 配下に変更がある場合は、`/ddd-review` に加えて `/ui-review` も実施する(ui-reviewer サブエージェントが `DESIGN.md` とプレゼンテーション層の観点でレビュー)。指摘の扱いは `/ddd-review` と同じ(must-fix は必須修正、suggestion も原則その場で対応、見送りは例外基準に該当する場合のみ Issue 化)。

## 6. PR 作成と CI ループ(外側ループ)

1. 受け入れ条件のチェックボックスを満たしているか最終確認する
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

`packages/web` 配下に変更がある PR は、コード diff だけでは見た目を判断できない。マージ判断者がコードを読まずに見た目を確認できるよう、変更に関係する画面を darling / honey 両テーマで撮影し、PR 本文に添付する(モック起動基盤 #141 を利用)。対話モード・無人モードとも実施する。

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

4. **PR 本文から参照できる形にして添付する**。GitHub の PR 本文はテキストのみで、画像は**リポジトリにコミット済みのファイルの URL 参照**でしか埋め込めない(MCP からのバイナリアップロードは不可)。次の方法で添付する:
   - 撮影した PNG を PR ブランチにコミットする。置き場: `docs/pr-screenshots/issue-<番号>/<screen>-<theme>.png`
   - PR 本文からは絶対 URL `https://github.com/<owner>/<repo>/blob/<headブランチ>/docs/pr-screenshots/issue-<番号>/<screen>-<theme>.png?raw=true` で参照する(認証済みのマージ判断者の画面でレンダリングされる。PR 本文中の相対パス画像はレンダリングされない)
   - `templates/pr-body.md` の「画面(スクリーンショット)」節のフォーマットに従って並べる。既存画面の見た目を変える変更では、可能なら変更前(`origin/main` を撮影)も併記する

   > これらの PNG はマージ判断のための添付物であり、マージすると `docs/pr-screenshots/` に残る。不要になれば人手で削除してよい(削除しても機能に影響しない)。

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

- **「UI 変更時のスクリーンショット添付」が必須**: 更新されたスナップショットだけでは見た目の妥当性を判断できない。darling / honey 両テーマのスクリーンショットをマージ判断者が確認できるよう、上記の手順に従って PR 本文に添付する
- **PR 本文にスナップショットを更新した旨と理由を記す**: `templates/pr-body.md` の「画面（スクリーンショット）」節に、更新した画面名と理由（「受け入れ条件に基づく意図した UI 変更」等）を書く

## 無人モード(Routine からの自動起動)

Routine のセットアップ手順とラベル運用は `docs/automation/backlog-routine.md` を参照。無人モードでは以下の差分を適用する。**1回の起動で作成する PR は最大1つ**。PR 作成に成功したらその fire は完了する。ただし、候補の撤退・スキップが発生した場合は次の候補へ進み、1件 PR 作成に到達するまで試行する(候補ループ。手順0「候補選定と排他ロック」参照)。

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

候補選定から排他ロックまでの全手順。スコープ B に従い、撤退・スキップ時は次候補へ進む(後述「候補ループ」)。

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
2. Routine 起点の PR に絞る(判別基準は `/pr-steward` 手順1と同一: 本文に「無人モードの選定理由」節がある / head ブランチが `feat/issue-N-` または `claude/issue-N-` で始まる / マージ判断 Issue が紐づく)。人間が手動作成した PR には触れない
3. `mergeable == CONFLICTING`(`gh` / GraphQL)または `mergeable_state == dirty`(REST / MCP)の PR があれば、候補選定より先に解消する。手順は `/pr-steward` 手順2c と同じ:
   ```bash
   git fetch origin <PRのheadブランチ> && git switch <PRのheadブランチ>
   git fetch origin main && git merge origin/main
   # コンフリクトを解消する。ドメインロジックの競合など判断が必要な場合は解消せず、
   # その PR と対象 Issue に needs-decision を付けて人間に委ね、次へ進む
   ```
   解消したら `/verify` を全 green にしてから push する。**マージはしない**(この preflight もマージ判断は人間に残す)
4. `unknown` のまま確定しない PR はコンフリクト判定を保留し、解消・needs-decision 化した PR とあわせて最終報告に含める。コンフリクトが無ければ何もしない

この修復で fire の所要時間は延びうるが、放置時間の上限が最長で fire 間隔（Routine の登録数とスケジュールに依存）に収まる。**WIP 上限超過で新規着手をスキップする場合でも、コンフリクト修復は実施する**(壊れた PR の放置を防ぐため、本 preflight は下の WIP 上限チェックより前に置く)。

#### WIP 上限チェック

open な PR の件数を数える:

```bash
gh pr list --state open --json number --jq 'length'
```

**5件以上**なら新規着手せず、「WIP 上限のためスキップ」と報告して終了する(レビュー待ち PR が溜まった状態で着手を重ねると、PR 同士のコンフリクトと依存切れを招くため)。

#### 候補選定と排他ロック(候補ループ)

`gh issue list --state open --label "ready-to-implement" --json number,title,labels,assignees,body,createdAt` から候補リストを取得し、以下をすべて満たす Issue を優先順に並べる:

- `status:in-progress` / `needs-decision` ラベルが付いていない
- 誰にも assign されていない
- 本文の「依存」「先行」節に挙げられた先行 Issue がすべてクローズ済み(open のものに依存していない)。「関連」「参考資料」内の Issue 参照は着手ブロック条件にしない(単なる参照)。依存待ちの ready Issue は正常な状態であり、条件を満たすまでスキップして次候補を見る

優先順は `priority:high` → 作成が古い順。

候補リストを先頭から順に試し、**1件 PR 作成に成功するか、候補を使い切るまで**ループする(最大試行数: **5件**。無限ループの歯止め):

1. **排他ロック(CAS)**: ロック付与の直前に Issue のラベル一覧を再取得し、`status:in-progress` が**既に付いていたら**その候補をスキップして次へ(並行 fire が先にロックした)。付いていなければ直ちに `status:in-progress` を付与する
2. **重複 PR ガード**: ロック取得後、手順1(Issue 理解)に入る前に、その Issue 番号 `N` に対して close キーワード集合(preflight 条件1参照)+ `#N` を含む **open または merged な PR** を検索し、結果で分岐する:
   - **open PR が見つかった** → `status:in-progress` を外してその候補をスキップし次へ(並行 fire が実装中)。スキップ理由は最終報告に含める
   - **merged PR が見つかった**(実装済みの PR がマージ済みなのに Issue が open のまま残っている異常状態) → `status:in-progress` と `ready-to-implement` を外し、元 Issue に `needs-decision` を付けて判断依頼コメント(`templates/judgment-issue.md` に従い、Issue をクローズしてよいか・残作業があるかの判断を依頼)を残して次候補へ。単にスキップするだけだと毎 fire 再検査・再スキップされて候補ループの枠を浪費し続けるため、人間に可視化して状態を解消する
3. 両ガードを通過したら、手順1へ進む
4. 手順1・5で撤退した場合も、ロックを解除して次候補へ進む(スコープ B)

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
- `/ddd-review` の suggestion でユーザーの意思決定が必要なもの(見送り例外に該当)は、既存ルール通り Issue 化する。その Issue も `templates/judgment-issue.md` のフォーマットで書き、`needs-decision` を付与したうえで、PR 本文の「あなたに判断してほしいこと」からリンクする

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

### 手順6の差分: PR 作成・CI green の確認・マージ判断 Issue

- **push / PR 作成直前の重複ガード**: `git push` の直前に、対象 Issue 番号 `N` に対して close キーワード集合(手順0 preflight 条件1参照)+ `#N` を含む **open または merged な PR** を再検索する(手順0のガードと同じ検索だが、実装中に並行 fire が先に PR を作った場合を捕捉する最終防衛線)。**1件でも見つかったら push せず撤退する**。`status:in-progress` を外し、作成済みのローカルブランチは残す(次の手動対応に備える)。この時点で自 fire のマージ判断 Issue はまだ存在しないため、撤退の記録は**元 Issue へのコメント**に残す(先行 PR の番号と「並行 fire の PR が既に存在するため撤退した」旨を執筆ルールに従って書く)。実装コストを二重に払わないため、候補ループには戻らず fire を終了する
- PR 本文は `templates/pr-body.md` のフォーマットで書き、通常の PR(Draft ではない)として作成する。ただし**マージ判断は必ず人間が行う**(自動マージは禁止。マージは `/decide` セッション内の明示承認か、ユーザー自身の操作でのみ行われる)
- **`packages/web` に変更がある場合**、push 前に手順6「UI 変更時のスクリーンショット添付」を実施し、darling / honey 両テーマの画面を PR 本文に添付する。無人モードではコード diff だけがマージ判断材料になりやすいため、見た目を可視化するこの添付が特に重要になる。ただし**撮影失敗は撤退・スキップの理由にしない**(添付なしで PR 作成を続行し、その旨を PR 本文に記す)
- PR 本文の `Closes #<番号>` は**必ず番号まで**書く(`Closes #` のまま残さない)。番号が無いと、重複 PR ガード・preflight 条件1・`notify-needs-decision.yml` のロック自動解除のすべてからその PR が不可視になり、二重着手防止が機能しない
- PR 作成直後に、対話モード手順6の**リンク検証**を必ず行う(本文の渡し方の注意も同じ: ファイル経由または実際の改行を含む文字列で渡し、リテラル `\n` を埋め込まない)。無人モードではマージまで人間が本文を見直す機会が無いため、この検証が auto-close 不発(= マージ済みなのに Issue が open のまま残る異常状態)を防ぐ唯一の防衛線となる
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
