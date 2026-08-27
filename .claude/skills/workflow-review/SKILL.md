---
name: workflow-review
description: 開発ワークフロー(docs/workflow・レビュー観点・Routine)を、外部の知識体系ポートフォリオ(SWEBOK v4 / DORA / AWS Well-Architected / OWASP SAMM)とライフサイクル網羅表(docs/workflow/06-lifecycle-coverage.md)を物差しに四半期で監査し、/retro(失敗データ駆動・週次)が構造的に検出できない「動いていない工程の欠落」を [改善案] + needs-decision Issue として起票する。読み取り専用(実施記録の追加を除く)で、既存のコード・docs は変更しない。
---

# 体系駆動の四半期レビュー(workflow-review)

`/retro` は無人運用(`/issue-work` 無人モード・`/pr-steward`)が生んだ**失敗データ**を振り返るため、**動いていない工程は原理的に視界に入らない**(CD・監視・バックアップの不在は失敗を生まないので、`/retro` の点検に一度も上がらなかった。`docs/workflow/research/2026-08-27-workflow-external-review.md` §2)。このスキルはその死角を補う。ライフサイクル網羅表(`docs/workflow/06-lifecycle-coverage.md`)と、外部の知識体系ポートフォリオ(SWEBOK v4・DORA・AWS Well-Architected・OWASP SAMM)のチェックリストをリポジトリの実体と突合し、乖離・欠落を `[改善案]` + `needs-decision` Issue として起票する。判断は `/decide` で人間が行う。

運用(四半期 Routine のセットアップ)は `docs/automation/workflow-review-routine.md` に定める。このスキルはその手順の本体を担う。

> **実行環境の注意**: 本書の `gh` コマンドは操作の意図を示すリファレンス。`gh` CLI が使えない環境(Claude Code on the web / Routine 起動セッションなど)では、GitHub MCP ツール(`mcp__github__*`: `search_issues` / `list_issues` / `issue_read` / `issue_write` / `add_issue_comment` / `create_pull_request` など)で同等の操作を行う。どちらも使えない場合は GitHub 操作を伴う手順を実行できないため、その旨を報告して終了する。

## 設計原則

- **読み取り専用(実施記録の追加を除く)** — このスキルは既存のコード・docs を変更しない。成果物は「乖離・欠落を報告する `[改善案]` Issue」と「実施記録ファイル1点」の2つだけ。実際の改善は起票した Issue を `/decide` で承認したうえで、別 fire の `/issue-work` が実装する。**唯一の書き込みは、下記手順6で `docs/workflow/research/` に追加する日付つき実施記録ファイルであり、これは起票と同じ fire 内で PR 経由で行う**(通常の実装 PR とは異なり、記録ファイル1点だけを差分に持つ軽量な PR)。他のファイル(`06-lifecycle-coverage.md` 本体・`05-criteria.md`・skills など)は一切変更しない — 状態の更新が必要と判断した場合も、それ自体を `[改善案]` Issue の提案内容として記述するに留める
- **失敗データは扱わない(`/retro` との責務分担)** — 収集対象に Routine 起点 PR・`needs-decision` Issue・撤退記録・CI 落ち・レビュー指摘の再発は含めない(すべて `/retro` の担当)。本スキルが見るのは「体系の項目とリポジトリの実体を突合したときの一致・不一致」だけであり、運用が最近失敗したかどうかは判定に使わない。同じ観点を2か所で見ない(`docs/review/README.md` §1-3 の原則をワークフロー自己監査にも適用する)
- **証拠ベース・保守的** — 突合対象(`06-lifecycle-coverage.md` の表・各体系のチェックリスト項目)に無い観点を持ち出さない。「なんとなく足りなそう」という主観的な指摘はしない。各指摘には根拠(表のどの行・どの体系のどの項目か)を必ず添える
- **空振りを許容する** — 乖離・欠落が見つからなければ何も起票せず、突合結果と「乖離なし」の報告だけで終える。無理に欠落を探さない
- **1 乖離・欠落 = 1 Issue** — 関連するものもまとめず個別に起票する。`/decide` で個別に採否を判断できるようにするため
- **どちらが正かは判断しない** — 網羅表の状態(✅/⚠️/❌)とリポジトリの実態が食い違う場合、「網羅表を実態に合わせて更新する」か「実態(未整備の状態)を改善する」かの両方を選択肢として Issue に示す。どちらを選ぶかは人間が判断する

## 手順

### 1. 前回実施記録の確認

`docs/workflow/research/` を日付降順で確認し、本スキルによる直近の実施記録(ファイル名末尾が `-workflow-review.md`)を探す。無ければ `2026-08-27-workflow-external-review.md`(体系駆動レビューの初回実施に相当)を前回相当として扱う。

前回記録の「検出した欠落・乖離」一覧と、対応する Issue(前回記録から起票されたもの、またはタイトルに前回記録へのファイル名を含む `[改善案]` Issue)の現在の状態(open / closed / 実装済みか)を確認し、**前回からの進捗**(解消済み・未解消・見送り済み)を把握する。これは今回の報告の「前回からの進捗」節に使う。

### 2. 網羅表(06-lifecycle-coverage.md)との突合

1. `docs/workflow/06-lifecycle-coverage.md` §2 の網羅表から、各行(KA1〜KA18)の「担保手段」「状態」「備考」を読み取る
2. 各行について、記載された担保手段(skill / CI ステップ / docs ファイル / Issue 番号)が**現在も実在し、記載どおりの状態か**を確認する:
   - 担保手段として挙げられた skill(`.claude/skills/*/SKILL.md`)・CI ステップ(`.github/workflows/ci.yml`)・docs ファイルが実在するか
   - 備考に挙げられた対応中 Issue(例: #736・#737・#738・#740)が closed になっていれば、その行の状態(⚠️/❌)が ✅ に上がっているべきでないかを確認する(実装が入ったのに網羅表が古いままの乖離)
   - 逆に、✅ と記載された行の担保手段(skill・CI ステップ)が削除・無効化されていないか(実装が退行したのに網羅表が古いままの乖離)
3. 網羅表に無い新しい工程・関心事が増えていないかを確認する(例: 新しい skill や CI ステップの追加で、SWEBOK 18 KA のどれかに実質的な変化が生じていないか)。ただし**新しい KA を勝手に追加しない** — 網羅表の行構成自体を変える提案は Issue の提案内容として書き、この手順で直接 docs を書き換えない

### 3. ポートフォリオ各体系のチェックリスト突合

`docs/workflow/research/2026-08-27-lifecycle-frameworks.md` §4「推奨 — 役割分担のポートフォリオ」が定めた4体系それぞれの担当範囲で、リポジトリの実体を突合する。SWEBOK v4(18 KA の網羅)は手順2で扱い済みなので、ここでは残り3体系を扱う:

1. **DORA Four Keys(デリバリーの KPI)** — `docs/workflow/05-criteria.md` 基準11「到達性」の現状評価(デプロイ頻度・リードタイム・変更失敗率・復旧時間)が、CD・監視・バックアップ関連の Issue(#56・#57 等)の進捗を反映してずれていないかを確認する。ずれていれば現状評価の改訂を `[改善案]` として提案する(本スキル自身は `05-criteria.md` を書き換えない)
2. **AWS Well-Architected(運用・信頼性・セキュリティの具体点検)** — `06-lifecycle-coverage.md` の該当行が引用する質問 ID(OPS 4/6/8・REL 9・REL 13・SEC06-BP01 等)について、それぞれの意図する対策(可観測性・バックアップ・DR・パッチ自動化)がリポジトリに実在するかを確認する。実在確認は表面的でよい(例: バックアップ手順を記述した docs ファイルがあるか、無いか)。詳細な監査はレビュースキルの担当であり、本手順はギャップの**存在**を検出するに留める
3. **OWASP SAMM v2(セキュアプロセスの成熟度)** — 15 プラクティスのうち、`docs/workflow/research/2026-08-27-lifecycle-frameworks.md` に既出のもの(Secure Deployment / Vulnerability Management 等)を中心に、L1 相当の実施有無をリポジトリの実体(CI ステップ・docs・skill)と突合する。全15プラクティスを毎回網羅する必要はなく、前回記録で「未確認」「要再確認」とした項目を優先する

### 4. `/retro` との重複回避チェック

起票前に、今回検出した各項目が `/retro` の管轄(失敗データ駆動の改善案)と重複していないかを確認する。次のいずれかに該当する項目は起票しない(`/retro` が既に扱っているか、扱うべき性質のもの):

- 直近の `[改善案]` Issue(`/retro` 起票分)に同じ趣旨のものが既に open で存在する
- 検出根拠が「特定 PR/Issue での失敗の再発」である(これは `/retro` の証拠であって本スキルの証拠ではない)

### 5. 乖離・欠落の評価と Issue 起票

検出した乖離・欠落それぞれについて:

1. **重複チェック**: 同じ乖離・欠落を報告する既存 Issue がないか、open と closed の両方を検索する(`search_issues` で `repo:... label:needs-decision "[改善案]"` 等、キーワードで検索)。**open な Issue が存在する場合はスキップ**。**not planned でクローズされた Issue が存在する場合**(人間が「対応不要」と判断済み)も、意図的な見送りとしてスキップし、再起票しない
2. **Issue 起票**: タイトル先頭に `[改善案]` を付ける(例: `[改善案] <改善対象の要約>`)。本文は `.claude/skills/issue-work/templates/judgment-issue.md` のフォーマットで書き、`.claude/skills/issue-work/SKILL.md`「人間向け報告の執筆ルール」を必ず適用する。冒頭の質問は「この改善案を採用してよいか?」を1文で。選択肢は「A: 採用して実装(`ready-to-implement` を付ける)/ B: 見送り(この Issue を閉じる)」を基本とする。「経緯」には根拠(網羅表のどの行、またはどの体系のどの項目から検出したか)を必ず引用する
3. ラベル付与(冪等):

   ```bash
   gh label create "needs-decision" --color D93F0B --description "人間の判断待ち" 2>/dev/null || true
   gh issue create --title "[改善案] ..." --body "..." --label "needs-decision"
   ```

複数の乖離・欠落が見つかった場合、関連するものもまとめず**1 乖離・欠落 = 1 Issue** で起票する。

### 6. 実施記録の保存(唯一の書き込み)

今回の突合結果を `docs/workflow/research/<実施日>-workflow-review.md` として、`2026-08-27-workflow-external-review.md` と同じ構成で残す:

- **検出した乖離・欠落**(表: # / 内容 / 根拠 / 該当する体系・網羅表の行)
- **前回からの進捗**(手順1で確認した、前回記録の各項目が解消・未解消・見送りのいずれかになったか)
- **処理の記録**(起票した Issue の一覧。番号・タイトル・反映先候補)
- **この記録の位置づけ**(本ファイルは検出時点のスナップショットであり、以後更新しない旨。状態の現在値はラベル・Issue・網羅表が持つ)

この記録は次の手順で PR 経由で追加する(このスキルで唯一コードリポジトリに書き込む操作):

```bash
git fetch origin main && git switch -c docs/workflow-review-<実施日> origin/main
# docs/workflow/research/<実施日>-workflow-review.md を追加
git add docs/workflow/research/<実施日>-workflow-review.md
git commit -m "docs(workflow): <実施日> の /workflow-review 実施記録を追加"
git push -u origin HEAD
```

PR は `.claude/skills/issue-work/templates/pr-body.md` のような詳細フォーマットを必要としない(実装 PR ではないため)。本文には突合結果の要約と、起票した `[改善案]` Issue へのリンクを書けばよい。`pnpm format:check` が green であることを確認してから push する。

**このPRは `.claude/skills/issue-work/SKILL.md` のマージゲート判定対象外**(Routine 起点の判別基準に該当しない — head ブランチが `feat/issue-N-` 等のパターンに一致せず、本文に「無人モードの選定理由」節も持たない)。無人 Routine で実行した場合も**このPRは自動マージされず、open のまま人間の確認・マージを待つ**。これは意図した設計であり、四半期に1回程度の低頻度な記録追加を、既存のマージゲート(Issue 実装の自動化)に無理に接続しないための選択。

### 7. 報告

以下を報告する:

- 前回実施記録のファイル名と、前回からの進捗サマリ
- 手順2(網羅表突合)・手順3(ポートフォリオ突合)の結果サマリ(確認した行・項目数、検出した乖離・欠落数)
- 起票した `[改善案]` Issue の一覧(番号・タイトル)
- 追加した実施記録ファイルのパスと、対応する PR の URL(マージゲート対象外であり人間の確認待ちである旨を明記する)
- 乖離・欠落が無い場合はその旨(「今期間は突合対象の乖離・欠落なし。Issue 起票なし」)。この場合も実施記録ファイルは残す(空振りだったこと自体が次回の突合材料になる)

## 制約

- **読み取り専用(実施記録の追加を除く)** — 既存のコード・docs(`06-lifecycle-coverage.md` 本体を含む)は変更しない。成果物は `[改善案]` Issue と、`docs/workflow/research/` への新規実施記録ファイル1点(PR 経由)のみ
- **自動適用しない** — 改善案は必ず `needs-decision` で人間の承認を待つ。`/decide` で採用されて初めて `/issue-work` が実装する
- **失敗データを収集しない** — Routine 起点 PR の往復・CI 落ち・レビュー指摘の再発は `/retro` の担当であり、本スキルの突合対象に含めない
- `status:in-progress` は `/issue-work` の排他ロック。workflow-review は着手ロックを使わない(実装を行わないため)し、他 Issue のロックにも触れない
