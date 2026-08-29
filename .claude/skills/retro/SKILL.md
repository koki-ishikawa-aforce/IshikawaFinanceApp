---
name: retro
description: 無人運用(Routine による /issue-work・/pr-steward)の失敗データを定期的に振り返り、繰り返す失敗パターンとワークフロー全体の点検から skills / CLAUDE.md / Issue テンプレート / docs/workflow(原則)の改善案を needs-decision Issue として起票する。読み取り専用で、コードも docs も変更しない。
---

# 無人運用の振り返り(retro)

無人モードの運用(Routine による `/issue-work` / `/pr-steward`)は、撤退・CI リトライ・レビュー指摘・マージまでの往復回数といった**失敗データを毎回捨てている**。このスキルは直近期間のそれらを収集し、繰り返し発生している失敗パターンの抽出と**ワークフロー全体の点検**(`docs/workflow` の原則・未解決課題との突合)を行い、`skills` / `CLAUDE.md` / `.github/ISSUE_TEMPLATE` / `docs/workflow` への改善案を **`needs-decision` ラベル付き Issue** として起票する。判断は `/decide` で人間が行う。

運用(週次 Routine のセットアップ)は `docs/automation/retro-routine.md` に定める。このスキルはその手順の本体を担う。

> **実行環境の注意**: 本書の `gh` コマンドは操作の意図を示すリファレンス。`gh` CLI が使えない環境(Claude Code on the web / Routine 起動セッションなど)では、GitHub MCP ツール(`mcp__github__*`: `list_issues` / `search_issues` / `list_pull_requests` / `search_pull_requests` / `issue_read` / `pull_request_read` / `add_issue_comment` / `issue_write` など)で同等の操作を行う。どちらも使えない場合は GitHub 操作を伴う手順を実行できないため、その旨を報告して終了する。

## 設計原則

- **読み取り専用** — このスキルはコードも docs も変更しない。成果物は「改善案の Issue」だけ。実際の改善は起票した Issue を `/decide` で承認したうえで、別 fire の `/issue-work` が実装する
- **人間の判断は needs-decision に集約する** — 改善案は自動で適用せず、`needs-decision` ラベル付き Issue として起票する。ラベル付与をトリガーに通知ワークフロー(`.github/workflows/notify-needs-decision.yml`)がメール通知を発生させ、`/decide` の一覧に載る
- **空振りを恐れない** — 改善対象が見つからない期間は何も起票せず、収集結果と「改善案なし」の報告だけで終える。無理に改善案を捻り出さない
- **証拠ベース・保守的** — 1 件きりの事象は「パターン」として扱わない。**2 回以上繰り返している**、または 1 件でも再発すれば手戻りが大きい失敗のみを改善対象にする。改善案には必ず根拠(どの PR / Issue で・何回起きたか)を添える

## 手順

### 1. 収集期間の決定

既定は**直近 1 週間**。呼び出し時に期間が指定されればそれに従う。期間の起点(例: `2026-07-17`)を確定し、以降の検索の `created`/`updated`/`closed` フィルタに使う。現在時刻は環境から取得する(`date -u` 等。スクリプト内で推測しない)。

### 2. データ収集

無人運用の痕跡を、以下の観点で網羅的に集める。各収集の結果は件数と代表例をメモに残す。

**第一の収集手段: tracking Issue のレコード集計。** 本文にマーカー `<!-- fire-record-tracking -->` を含む open Issue を検索する(`.claude/skills/issue-work/SKILL.md`「手順8: fire 終了時の記録」がレコード形式とコード表の唯一の定義)。見つかれば、収集期間内のコメントを取得し(`gh issue view <番号> --comments` または GitHub MCP `issue_read` method `get_comments`)、各コメント本文の JSON Lines をパースして `kind` / `result` / `reason_code` / `ci_retries` / `gate_fail_conditions` / `filed_issues` を集計する。これで下記1〜5の観点の大半(撤退理由の内訳・CI リトライ回数・マージゲート落ち条件・起票 Issue との対応)が grep + 集計で得られる。tracking Issue が無い、または収集期間の記録が薄い(運用開始直後で蓄積が少ない等)場合は、その旨を記録した上で下記の**テキスト発掘をフォールバック**として実行し、集計を補う。

1. **マージ済み / クローズされた PR**(Routine 起点):

   収集期間内に**作成された** PR に加え、起点より前に作られて**期間内にマージ / クローズされた** PR(長く滞留した PR ほど失敗データとして重要)も拾う。`created` だけで絞ると後者を取りこぼすため、`created` / `merged` / `closed` の 3 つの検索を実行し、PR 番号で重複を除いて 1 つの集合にまとめる:

   ```bash
   gh pr list --state all --json number,title,state,mergedAt,closedAt,headRefName,body,labels --search "created:>=<起点>"
   gh pr list --state all --json number,title,state,mergedAt,closedAt,headRefName,body,labels --search "merged:>=<起点>"
   gh pr list --state all --json number,title,state,mergedAt,closedAt,headRefName,body,labels --search "closed:>=<起点>"
   ```

   (GitHub MCP の場合は `search_pull_requests` に `repo:<owner>/<repo> created:>=<起点>` / `merged:>=<起点>` / `closed:>=<起点>` の 3 クエリを投げ、`number` で重複排除する。)

   Routine 起点の判別基準は `/issue-work` の「マージゲート」条件1と同じ(本文に「無人モードの選定理由」セクションがある / head ブランチが `feat/issue-N-`・`claude/issue-N-`・`chore/cleanup-pr-screenshots`・`revert/main-failure-` で始まる)。各 PR について次を読み取る:
   - **マージまでの往復回数**: コミット数・force-push 回数・「コンフリクト解消」「CI 修復」を示す本文/コミットの記述
   - **マージされずにクローズされた PR**: 却下理由(あればレビューコメント)
   - **本文の異常**: リテラル `\n` の混入、`Closes #` の番号欠落(auto-close 不発の兆候)
   - **自動マージが止まった PR**: `needs-decision` が付いた PR と、マージゲートのどの条件で落ちたか。同じ条件で繰り返し止まっているならゲートか手順に改善余地がある
   - **自動マージ後に `main` を壊した PR**: `[main 赤]` Issue と対応するマージ。ローカル `/verify` と CI の乖離、semantic conflict のどちらが原因かを分類する

2. **`needs-decision` Issue**(open + 直近クローズ):

   ```bash
   gh issue list --state all --label "needs-decision" --json number,title,body,state,createdAt,closedAt,labels --search "created:>=<起点>"
   ```

   種別(`main` 赤 / マージ保留 PR / 見送り追認 / 撤退時の確認)ごとに数え、**撤退時の確認**は理由の偏りに注目する(受け入れ条件の曖昧さ・設計判断の未解決など、どの原因が多いか)。`main` 赤の件数は、自動マージが `main` を壊した頻度そのものなので単独で追う。

3. **撤退記録**: 撤退は元 Issue へのコメント(`/issue-work` 無人モード)や、先行 PR 検知時の元 Issue コメントに残る。上記 Issue の最新コメント(`gh issue view <番号> --comments`)から撤退理由を抽出する。同じ Issue で撤退が繰り返されていないかを確認する。

4. **CI 落ちの類型**: Routine 起点 PR の失敗した CI 実行を確認する(GitHub MCP `get_job_logs` / `gh run list --branch <headRef>`)。同じジョブ(build / typecheck / test / lint / format:check / 統合テスト)での失敗が繰り返していないか、原因の類型(統合テスト漏れ・format 崩れ・トークン直値混入など)を分類する。

5. **レビュー指摘の再発**: PR 本文の「DDD レビュー(/ddd-review)を実施し…」の記述や、`/ddd-review` の must-fix / suggestion 履歴から、同種の指摘(例: 直値のトークン化、否定形テストの欠落)が別 PR で繰り返し挙がっていないかを見る。

### 3. 失敗パターンの抽出

収集データから、**繰り返し発生している**失敗を抽出する。判断基準は原則「2 回以上」または「1 回でも再発時の手戻りが大きい」もの。典型的なパターン軸:

- **撤退理由の偏り** — 特定原因(受け入れ条件の曖昧さ等)での撤退が集中している
- **CI 落ちの類型** — 特定ジョブでの失敗が繰り返す(例: ローカルで統合テストを回せず CI で初めて赤)
- **レビュー指摘の再発** — 同じ観点の must-fix / suggestion が複数 PR に出続ける
- **プロセスの穴** — auto-close 不発、二重着手、ゴミロック残りなど、仕組みの隙間を突く事故

各パターンについて「何が・何回・どの PR/Issue で」を根拠として固める。単発の事象はパターンとしない(報告には載せてよいが起票はしない)。

### 4. 改善案の導出

抽出したパターンごとに、再発を防ぐ最小の変更案を、対象を明示して導く:

| パターンの根                                            | 改善の反映先(候補)                                           |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| skill の手順の穴・曖昧さ                                | `.claude/skills/*/SKILL.md`(該当スキル)                      |
| セッション毎の運用指示(要約・索引)                      | `CLAUDE.md`                                                  |
| ワークフローの原則・設計判断の根拠・工程やラベルの仕様  | `docs/workflow/*.md`(原則は `04-principles.md` の該当原則へ) |
| Issue の書き方に起因(受け入れ条件が曖昧で撤退が続く 等) | `.github/ISSUE_TEMPLATE/*.md`                                |
| 運用フロー・Routine 設定                                | `docs/automation/*.md`                                       |

改善案は「機械的に検証できる変更」に落とし込む(チェックリストの追加・手順の明文化・テンプレート項目の追加など)。設計判断を伴う大きな変更は、案の粒度を「別途 `/issue-create` で分解が必要」と明記するにとどめる。

### 5. ワークフロー全体の点検

個別の失敗パターン(手順3〜4)に加えて、**ワークフローそのものの欠陥**を点検する。個々の fire は自分の失敗しか見えないため、横断して見るこの工程が `docs/workflow`(開発ワークフロー仕様)の改訂起点になる。

1. **基準に照らした評価**: `docs/workflow/05-criteria.md` の各基準の「測り方」に沿って今期間を観測し、現状評価(判定・根拠)が変わったと判断したら評価の改訂案を改善案の候補にする
2. **原則との突合**: `docs/workflow/04-principles.md` の各原則(原則 / 根拠 / 実装 / 適用限界)を、今回収集した運用データと突合する。原則が実運用で守られていない・適用限界が実際より狭い/広い・新しい失敗がどの原則にもカバーされていない、のいずれかがあれば改善案の候補にする(原則の改訂・適用限界の更新・新しい原則の追加)
3. **未解決課題の進展確認**: 同ファイル「未解決の課題」の各行について、今期間のデータで進展・悪化があったか(例: semantic conflict の発生、承認ゲートを通らない経路の拡大)を確認し、変化があれば課題行の更新案を改善案にする
4. **改善ループの健全性とバックログの収束**: `[改善案]` Issue の起票数と消化数(`/decide` での採否)を集計する:

   ```bash
   gh issue list --state all --search "[改善案] in:title" --json number,title,state,createdAt,closedAt,labels
   ```

   起票が消化を上回り続けて滞留しているなら、それ自体をワークフローの欠陥(改善ループが閉じていない)として改善案に上げる。あわせて**バックログ全体の純増減**(期間内の closed Issue 数 − ワークフロー自身が生んだ新規 Issue 数。人間起点の新規要件は分けて数える)と、**マージ1件あたりの派生 Issue 数**(レビュー見送り / 判断待ち / 改善案 / 乖離報告の内訳つき)を集計する(`docs/workflow/05-criteria.md` 基準9の測り方)。増殖率が1以上の期間が続くなら、派生 Issue の粒度・起票閾値をワークフローの欠陥として改善案に上げる

この工程の改善案にも手順3と同じ基準(証拠ベース・保守的)を適用する。運用データの裏付けがない抽象的な設計論は起票しない。

ただし、**リポジトリ・docs の状態から機械的に確認できる構造的な欠落**は、無人運用の失敗データ(撤退・CI 落ち等)が無くても証拠として扱ってよい(「証拠ベース」の原則そのものは変えず、証拠になりうるものの範囲を広げる)。例:

- `docs/acceptance/` の受入シナリオに記載された本番 URL が placeholder のまま N 週間放置されている
- `docs/workflow/06-lifecycle-coverage.md` の実行基盤欄が「未登録」のまま複数四半期経過している
- `docs/domain/09-aggregates.md` に、実装済みの集約や不変条件が記載されていない(`/docs-drift` が拾わない粒度のもの)

この場合の根拠は「どのファイルの・どの記述が・実装や運用実態とどう食い違っているか」を明記する(通常の改善案と同じく、単発の些細な表記ゆれは対象にしない)。

反映先は `docs/workflow/05-criteria.md`(現状評価の改訂)・`docs/workflow/04-principles.md`(原則の改訂)・`docs/workflow/01〜03`(工程・ラベル・実行基盤の仕様)。

### 6. Issue 化(改善案がある場合のみ)

改善案があれば、`needs-decision` ラベル付き Issue として起票する。**このスキル自身はファイルを変更しない**(改善案は Issue の本文に書き、実装は承認後の別 fire に委ねる)。

- タイトルは先頭に種別目印 `[改善案]` を付ける(例: `[改善案] <改善対象の要約>`)。目印はメール件名での種別識別と @メンション文面の出し分けに使われる(`.claude/skills/issue-work/templates/judgment-issue.md`「タイトルの種別目印」を参照)
- 本文は `.claude/skills/issue-work/templates/judgment-issue.md`(見送り追認の用途)のフォーマットで書き、SKILL.md 側の「人間向け報告の執筆ルール」を必ず適用する
- 冒頭の質問は「この改善案を採用してよいか?」を 1 文で。選択肢は「A: 採用して実装(`ready-to-implement` を付ける)/ B: 見送り(この Issue を閉じる)」を基本とする
- 「経緯」に**根拠**(どの PR/Issue で・何回起きたか)を必ず引用する
- ラベル付与(冪等):

  ```bash
  gh label create "needs-decision" --color D93F0B --description "人間の判断待ち" 2>/dev/null || true
  gh issue edit <番号> --add-label "needs-decision"
  ```

改善案が複数ある場合、関連するものはまとめず**1 改善 = 1 Issue**で起票する(`/decide` で個別に採否を判断でき、採用分だけ `ready-to-implement` に付け替えられるため)。

### 7. 報告

以下を報告する:

- 収集期間と収集件数(PR / needs-decision Issue / 撤退記録 / CI 落ち)
- 抽出した失敗パターン(根拠つき)
- ワークフロー全体の点検結果(原則との突合・未解決課題の進展・改善ループの滞留状況)
- 起票した改善案 Issue の一覧(番号・タイトル・反映先)
- **open な `needs-decision` Issue の一覧(番号・タイトル・滞留日数)** — 収集期間に関わらず、報告時点で open な全件を対象にする(メール通知の見落としに対する週次の保険):
  ```bash
  gh issue list --state open --label "needs-decision" --json number,title,createdAt
  ```
  (GitHub MCP の場合は `list_issues` に `state: OPEN`, `labels: ["needs-decision"]` を指定する。)滞留日数は `needs-decision` ラベル付与時刻(タイムラインから取得できない場合は Issue 作成時刻で代用)から報告時点までの日数とする
- 改善案が無い期間はその旨(「今期間は再発パターンなし。起票なし」)

## 制約

- **読み取り専用** — コード・docs・skills を変更しない。成果物は改善案 Issue のみ
- **自動適用しない** — 改善案は必ず `needs-decision` で人間の承認を待つ。`/decide` で採用されて初めて `/issue-work` が実装する
- **保守的に** — 単発事象を過度に一般化しない。根拠が示せる再発パターンのみ起票する
- `status:in-progress` は `/issue-work` の排他ロック。retro は着手ロックを使わない(読み取り専用のため)し、他 Issue のロックにも触れない
