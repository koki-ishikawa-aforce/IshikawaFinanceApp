# バックログ自動消化 Routine

`ready-to-implement` ラベル付きの Issue を、Claude Code の Routine(定期実行・fire ごとに fresh session)で1件ずつ無人実装し、PR 作成まで進める仕組み。実装手順の本体は `.claude/skills/issue-work/SKILL.md` の「無人モード」節にあり、このドキュメントはその運用(ラベル・Routine 設定・スロットル)を定める。

## 全体像

```
人間: Issue に ready-to-implement を付与(着手承認。依存が open でも付与可)
  ↓
Routine(毎時 fire・fresh session): 無人モードで /issue-work
  ├─ preflight: ゴミロックを機械的に回収(open PR なし + 2時間以上経過の両方をコマンドで確定)
  │            + Routine 起点 open PR のコンフリクトを先に解消(main をマージ → /verify → push)
  ├─ WIP 上限超過 or 候補なし → 何もせず終了(コンフリクト修復は WIP 超過でも先に実施)
  └─ 候補ループ(最大5件): 先頭から順に試行
      ├─ CAS ロック失敗(並行 fire が先行) → 次候補へ
      ├─ 重複 open PR 検知(並行 fire が実装中) → ロック解除 → 次候補へ
      ├─ merged PR 検知(Issue が open のまま残る異常) → ロック解除 + needs-decision → 次候補へ
      ├─ 判断が必要 → needs-decision を付けて撤退 → 次候補へ
      └─ 着手成功 → 実装 → /verify(統合テスト含む) → /ddd-review
          → push 前に重複 PR を再チェック(最終防衛線)
          → PR + マージ判断 Issue(needs-decision → メール通知) → PR の CI が green になるまで確認
  ↓
人間: needs-decision の一覧から判断し、PR をレビューしてマージ(これが実質のスロットル。/decide で対話消化できる)
```

設計原則:

- **人間の判断タスクは needs-decision Issue に集約する** — 撤退時の確認・レビュー見送りの追認・マージ判断のすべてを `needs-decision` ラベル付き Issue にする。判断待ちの全量は [`is:issue is:open label:needs-decision`](https://github.com/koki-ishikawa-aforce/IshikawaFinanceApp/issues?q=is%3Aissue+is%3Aopen+label%3Aneeds-decision) で一覧でき、ラベル付与をトリガーに通知ワークフローがメールを発生させる(後述の「通知」節)。判断依頼の書き方は issue-work スキルのテンプレート(`.claude/skills/issue-work/templates/`)と執筆ルールに従う。消化する側の手順は `/decide` スキル(`.claude/skills/decide/SKILL.md`)に定める

- **1 fire = 最大1 PR = 1 fresh session** — セッションの長時間化によるコンテキスト劣化を避ける。複数件の消化は fire の回数で稼ぐ(毎時 fire なら1日最大〜24件)。ただし撤退・スキップが発生した場合は候補ループで次の Issue へ進み、1件 PR 作成に到達するまで試行する(最大5候補)
- **人間の承認は「着手前のラベル付け」に前倒し** — `ready-to-implement` を付ける行為が着手承認。無人モードは承認済みの Issue にしか触れない
- **「完了」は PR の CI が green であること** — 1 fire は PR 作成では終わらない。作成した PR の CI(統合テストを含む)が green になるのを同一 fire 内で確認して初めて完了とする。`pnpm test` は adapters-neon の統合テストを含まないため「ローカル `/verify` 全 green」＝「CI green」ではない。CI が赤なら同一 fire 内で修正 → 再 push し、直せなければ(同一エラーで3回失敗)マージ判断 Issue に状況を記録して撤退する(赤い PR を「完了」として放置しない)。詳細は `.claude/skills/issue-work/SKILL.md` 無人モード手順6
- **PR 作成で止める(自動マージはしない)** — PR は通常(non-Draft)で作成するが、マージ判断は必ず人間が行う(`/decide` セッション内の明示承認を含む)。Routine 自身による自動マージはしない
- **ready 化と実装は分離する** — 無人消化 Routine 自身は `/backlog-ready` を実行しない(候補が尽きても自分でラベルを付けて補充しない)。ready 化は人間が起点のセッション(`/issue-create` の手順4、または `/backlog-ready` の明示的な実行)でのみ行う。これを崩すと承認ゲートが消える

## ラベル運用

| ラベル | 付ける人 | 意味 |
| --- | --- | --- |
| `ready-to-implement` | 人間 / `/backlog-ready` | 無人実装してよい(承認)。依存する先行 Issue が open でも付与でき、その間の着手は Routine の依存チェックが自動で遅延する |
| `status:in-progress` | 無人モード | 着手中(fire 間の排他ロック)。対話モードの着手宣言と共通 |
| `needs-decision` | 無人モード | 人間の判断待ち(撤退時の確認・見送り追認・マージ判断)。付与をトリガーに通知ワークフローがメール通知を発生させる。元 Issue に付いた場合は、人間が回答して `needs-decision` を外し `ready-to-implement` を付け直すまで無人モードの対象外。消化は `/decide` で行える |

旧 `needs-clarification` ラベルは `needs-decision` に統合した(残っている Issue があれば付け替える)。

ready 化は手動のほか、`/backlog-ready` スキル(`.claude/skills/backlog-ready/SKILL.md`)でまとめて行える。open Issue を「リポジトリ内で完結・受け入れ条件が検証可能・依存解決済み・設計判断なし・1 PR 粒度」の基準で判定し、該当分にラベルを付けて ready/見送りの一覧を報告する。判定は保守的(迷ったら付けない)。

ワークフローへの組み込み: 新規 Issue は `/issue-create` が作成時に同じ基準で判定して ready 化する。依存チェーンの下流も承認済みなら同時に ready にしておけるため、**PR をマージすると次の fire が依存解除された Issue を自動で拾う**(マージするだけでチェーンが順に消化される)。`/backlog-ready` の再実行は、依存以外の理由(条件の曖昧さ・粒度など)で見送っていた Issue を再判定したいときに行う。

ラベルの初回作成(冪等):

```bash
gh label create "ready-to-implement" --color 0E8A16 --description "無人実装してよい" 2>/dev/null || true
gh label create "needs-decision" --color D93F0B --description "人間の判断待ち" 2>/dev/null || true
```

## Routine のセットアップ

[claude.ai](https://claude.ai) の Claude Code → Routines から作成する(Routine はクラウド側で動くため、手元のセッションや PC の状態に依存しない)。

- **Environment**: このリポジトリ(`koki-ishikawa-aforce/IshikawaFinanceApp`)を含む環境。ネットワークポリシーは pnpm install と GitHub 操作が通る設定にする。`gh` CLI が無い環境でも動くよう、スキル側は GitHub MCP ツールへのフォールバックを定めている(issue-work スキルの「実行環境の注意」)
- **Trigger**: Schedule、毎時(消化ペースを落としたい場合は間隔を広げる)
- **Session**: fire ごとに新規セッション
- **Prompt**(そのまま貼り付け):

  ```
  無人モードで /issue-work を実行してください。

  - ready-to-implement ラベル付きの open Issue から1件だけ選んで実装し、PR の作成まで行ってください(マージはしない)
  - WIP 上限・排他ロック・曖昧なときの撤退・PR 化は .claude/skills/issue-work/SKILL.md の「無人モード」節に従ってください
  - 人間の判断が必要になった場合(撤退・見送り追認・マージ判断)は、SKILL.md の指示どおり needs-decision ラベル付きの Issue に集約し、テンプレートと執筆ルールに従って書いてください
  - 着手できる Issue がない場合(WIP 上限超過・候補なし)は、リポジトリに一切変更を加えず理由だけ報告して終了してください
  ```

  プロンプトを変更した場合は、claude.ai 側の Routine に貼り直すまで反映されない(Routine のプロンプトはリポジトリからは変更できない)。

## 通知(判断待ちをメールで受け取る)

GitHub は**自分自身の操作を通知しない**。Routine はあなたのアカウントで Issue・PR を操作するため、Routine が作った PR や判断依頼は、Watch 設定をどう変えてもそのままではメールが届かない。そこで `.github/workflows/notify-needs-decision.yml` が github-actions bot(= 別のアクター)として以下を行い、Participating 通知(メール)を発生させる:

| イベント | bot の動作 | 結果 |
| --- | --- | --- |
| Issue に `needs-decision` が付いた | あなたを assignee に追加 + @メンションコメント | メール通知 |
| PR が作成された(Draft・通常を問わない) | あなたを assignee に追加 | メール通知(マージ判断 Issue が作られなかった場合の保険も兼ねる) |
| PR がマージ/クローズされた | 対応するマージ判断 Issue(本文の `<!-- merge-judgment-pr: N -->` マーカーで特定)を自動クローズ | 判断待ち一覧が自動で片付く |
| PR が**マージされずに**クローズされた | その PR が `Closes #N` で紐づけていた open Issue の `status:in-progress` を自動解除 | 着手中ロックが残らず、次の fire が再着手できる(下記「ゴミロックの自動回収」) |

前提条件: GitHub の [Settings → Notifications](https://github.com/settings/notifications) で「Participating, @mentions and custom」の Email が有効になっていること(既定で有効)。メールが届かない場合はまずここを確認する。

## ゴミロックの自動回収

`status:in-progress` は fire 間の排他ロックだが、fire が異常終了したり、実装した PR を人間が**マージせずクローズ**したりすると、ロックだけが Issue に残る(=ゴミロック)。ゴミロックが付いた Issue は候補選定から除外され続けるため、放置すると `ready-to-implement` な Issue が全部ゴミロック済みになり、**Routine が毎 fire「候補なし」でスキップし続けてバックログが完全に止まる**(2026-07-23 に実際に発生)。

これを防ぐため、2つの仕組みでロックを自動回収する:

1. **即時回収(GitHub Actions)** — PR が**マージされずにクローズ**されたら、`.github/workflows/notify-needs-decision.yml` の `unlock-in-progress-on-pr-close` ジョブが、その PR が `Closes #N` で紐づけていた open Issue から `status:in-progress` を外す。人間がレビューで PR を却下(クローズ)したケースを即座に解除する。`ready-to-implement` はそのままなので、次の fire が再着手する(却下したまま止めたい場合は `ready-to-implement` も外す)。

2. **preflight 自己回復(issue-work スキル)** — 各 fire は候補選定の前に、`status:in-progress` 付き open Issue のうち「**紐づく open PR が無い** かつ **ロックが2時間以上前**」のものからロックを外す(`.claude/skills/issue-work/SKILL.md` 無人モードの preflight)。PR を作らずに死んだ fire(即時回収の対象外)を拾う保険。**2条件はコマンド出力で機械的に確定させ、自然言語の判断で条件を緩めない**(2026-07-24 の二重着手事故は条件違反が直接原因)。

いずれもロックを外すだけで、`ready-to-implement` などの他ラベルには触れない。

## コンフリクトの先解消(preflight)

複数の PR が同じファイルを触っていると、1件マージした瞬間に残りの PR がコンフリクト(base の `main` と PR の変更が衝突して自動マージできない状態)になる。これを直す役は `/pr-steward` だが、PR 執事 Routine はバックログ Routine とは別スケジュールのため、コンフリクトが次の巡回まで放置されうる(2026-07-24 の PR #191 で実際に発生)。

これを防ぐため、毎時確実に動くバックログ Routine の preflight に「コンフリクトの先解消」を組み込む(`.claude/skills/issue-work/SKILL.md` 無人モードの preflight)。各 fire は候補選定の前に、Routine 起点の open PR の mergeable 状態を機械的に確認し、コンフリクトがあれば `main` をマージ → `/verify` → push で先に解消してから新規着手へ進む。これにより:

- コンフリクトの放置時間の上限が、最長でも fire 間隔(約20分)に収まる
- 「壊れた PR を放置したまま新しい PR を積み増して衝突を広げる」事態を避けられる(WIP 上限超過で新規着手をスキップする fire でも、コンフリクト修復だけは先に実施する)

mergeable は GitHub が照会して初めて計算するため直後は `unknown`(計算中)が返りうる。preflight・`/pr-steward` とも `unknown` の PR は数秒待って再照会し、確定しないものはコンフリクト判定を保留して報告に残す(誤って「問題なし」と扱わない)。解消時のコンフリクトにドメインロジックの競合など判断が必要なものが含まれる場合は、解消せず `needs-decision` で人間に委ねる。**マージ自体は preflight・`/pr-steward` とも行わない**(マージ判断は人間の原則を維持)。

## 統合テストの実行(無人環境)

CI は `.github/workflows/ci.yml` の専用ステップで adapters-neon の統合テスト(`test:integration`・要 PostgreSQL)を必ず実行する。`pnpm test` はこれを含まないため、無人モードが「ローカル全 green」で止まると CI で初めて赤が判明する。これを防ぐため、無人モードは次の2点を守る(手順の本体は `.claude/skills/verify/SKILL.md`「統合テスト」節):

- **実行判定を広げる(P1 の再発防止)** — 統合テストは「`packages/adapters-neon` の変更時のみ」ではなく、**`packages/domain` の振る舞い変更または `packages/adapters-neon` の変更があれば実行**する。統合テストは domain 層のプライバシー/Query 挙動を通しで検証するため、adapters-neon の実装を一切触らない domain 変更でも統合テストが壊れることがある(実例: `applyPrivacyFilter` の変更で `transactionListQuery.test.ts` が失敗)。
- **イメージ pull 不可時のフォールバック(P2)** — Routine 相当の環境ではネットワークポリシーにより `postgres:16` イメージの pull が 403 になり `docker compose up -d db` が失敗する。その場合はインストール済みの PostgreSQL 16 バイナリ(例: `/usr/lib/postgresql/16/bin`)を `postgres` ユーザーで直接 `initdb`/起動してテストする(具体コマンドは verify スキルに記載)。docker もローカルバイナリも使えないときは、統合テストは「CI で初めて検証される未確認の変更」となるため、手順6 の **CI green 確認**が最後の砦になる。

## パラメータ(チューニングポイント)

| パラメータ | 既定値 | 変える場所 |
| --- | --- | --- |
| WIP 上限(open な PR 数) | 5 | SKILL.md 無人モード 手順0 |
| 候補ループ上限(1 fire あたりの最大試行数) | 5 | SKILL.md 無人モード 手順0 |
| 消化ペース | 毎時1件 | Routine のスケジュール |
| ゴミロック回収の経過時間しきい値 | 約2時間 | SKILL.md 無人モード preflight(fire のセッション寿命より十分長く保つ) |

WIP 上限はレビューが追いつく範囲に保つ。未マージの PR はすべて main 起点のため、溜まるほどマージのたびに他 PR がコンフリクトしやすくなる。

## 止め方・トラブル時

- **一時停止**: Routine を無効化する(claude.ai の Routines 画面)。実行中の fire には影響しない
- **着手したまま放置された Issue**(fire が異常終了した場合など): 下記「ゴミロックの自動回収」で自動的に解除されるため、通常は手動対応不要。急ぐ場合や自動回収の条件(ロックが2時間以上前)に満たない場合は、`status:in-progress` が付いているのに対応ブランチ/PR がないことを確認して手動でラベルを外せば、次の fire が再度拾う
- **同じ Issue で撤退が繰り返される**: `needs-decision` の判断依頼コメントに回答し、`needs-decision` を外して `ready-to-implement` を付け直す。受け入れ条件そのものを `/issue-create` の基準(検証可能なチェックボックス)で書き直すのが根本対応
- **同じ Issue に複数の PR が作られた**: 重複 PR ガード(CAS ロック + push 前の重複チェック)で防止されるが、万一発生した場合は PR 執事(`/pr-steward`)が検知して `needs-decision` で通知する。残す PR を判断してクローズする
- **PR をマージしたのにマージ判断 Issue が残っている**: 通知ワークフローの自動クローズはマーカー `<!-- merge-judgment-pr: N -->` で対応 PR を特定する。マーカーが本文にない場合は手動でクローズする
