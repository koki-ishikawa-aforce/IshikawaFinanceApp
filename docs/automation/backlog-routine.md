# バックログ自動消化 Routine

`ready-to-implement` ラベル付きの Issue を、Claude Code の Routine(定期実行・fire ごとに fresh session)で1件ずつ無人実装し、Draft PR まで進める仕組み。実装手順の本体は `.claude/skills/issue-work/SKILL.md` の「無人モード」節にあり、このドキュメントはその運用(ラベル・Routine 設定・スロットル)を定める。

## 全体像

```
人間: Issue に ready-to-implement を付与(着手承認。依存が open でも付与可)
  ↓
Routine(毎時 fire・fresh session): 無人モードで /issue-work
  ├─ WIP 上限超過 or 候補なし → 何もせず終了
  ├─ 判断が必要 → needs-decision を付けて撤退(→ 通知ワークフローがメール通知)
  └─ 1件選定 → status:in-progress で排他ロック → 実装 → /verify → /ddd-review
      → Draft PR + マージ判断 Issue(needs-decision → メール通知)
  ↓
人間: needs-decision の一覧から判断し、Draft PR をレビューしてマージ(これが実質のスロットル)
```

設計原則:

- **人間の判断タスクは needs-decision Issue に集約する** — 撤退時の確認・レビュー見送りの追認・マージ判断のすべてを `needs-decision` ラベル付き Issue にする。判断待ちの全量は [`is:issue is:open label:needs-decision`](https://github.com/koki-ishikawa-aforce/IshikawaFinanceApp/issues?q=is%3Aissue+is%3Aopen+label%3Aneeds-decision) で一覧でき、ラベル付与をトリガーに通知ワークフローがメールを発生させる(後述の「通知」節)。判断依頼の書き方は issue-work スキルのテンプレート(`.claude/skills/issue-work/templates/`)と執筆ルールに従う

- **1 fire = 1 Issue = 1 fresh session** — セッションの長時間化によるコンテキスト劣化を避ける。複数件の消化は fire の回数で稼ぐ(毎時 fire なら1日最大〜24件)
- **人間の承認は「着手前のラベル付け」に前倒し** — `ready-to-implement` を付ける行為が着手承認。無人モードは承認済みの Issue にしか触れない
- **Draft PR で止める** — マージ判断は必ず人間。自動マージはしない
- **ready 化と実装は分離する** — 無人消化 Routine 自身は `/backlog-ready` を実行しない(候補が尽きても自分でラベルを付けて補充しない)。ready 化は人間が起点のセッション(`/issue-create` の手順4、または `/backlog-ready` の明示的な実行)でのみ行う。これを崩すと承認ゲートが消える

## ラベル運用

| ラベル | 付ける人 | 意味 |
| --- | --- | --- |
| `ready-to-implement` | 人間 / `/backlog-ready` | 無人実装してよい(承認)。依存する先行 Issue が open でも付与でき、その間の着手は Routine の依存チェックが自動で遅延する |
| `status:in-progress` | 無人モード | 着手中(fire 間の排他ロック)。対話モードの着手宣言と共通 |
| `needs-decision` | 無人モード | 人間の判断待ち(撤退時の確認・見送り追認・マージ判断)。付与をトリガーに通知ワークフローがメール通知を発生させる。元 Issue に付いた場合は、人間が回答して `needs-decision` を外し `ready-to-implement` を付け直すまで無人モードの対象外 |

旧 `needs-clarification` ラベルは `needs-decision` に統合した(残っている Issue があれば付け替える)。

ready 化は手動のほか、`/backlog-ready` スキル(`.claude/skills/backlog-ready/SKILL.md`)でまとめて行える。open Issue を「リポジトリ内で完結・受け入れ条件が検証可能・依存解決済み・設計判断なし・1 PR 粒度」の基準で判定し、該当分にラベルを付けて ready/見送りの一覧を報告する。判定は保守的(迷ったら付けない)。

ワークフローへの組み込み: 新規 Issue は `/issue-create` が作成時に同じ基準で判定して ready 化する。依存チェーンの下流も承認済みなら同時に ready にしておけるため、**Draft PR をマージすると次の fire が依存解除された Issue を自動で拾う**(マージするだけでチェーンが順に消化される)。`/backlog-ready` の再実行は、依存以外の理由(条件の曖昧さ・粒度など)で見送っていた Issue を再判定したいときに行う。

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

  - ready-to-implement ラベル付きの open Issue から1件だけ選んで実装し、Draft PR の作成まで行ってください
  - WIP 上限・排他ロック・曖昧なときの撤退・Draft PR 化は .claude/skills/issue-work/SKILL.md の「無人モード」節に従ってください
  - 人間の判断が必要になった場合(撤退・見送り追認・マージ判断)は、SKILL.md の指示どおり needs-decision ラベル付きの Issue に集約し、テンプレートと執筆ルールに従って書いてください
  - 着手できる Issue がない場合(WIP 上限超過・候補なし)は、リポジトリに一切変更を加えず理由だけ報告して終了してください
  ```

  プロンプトを変更した場合は、claude.ai 側の Routine に貼り直すまで反映されない(Routine のプロンプトはリポジトリからは変更できない)。

## 通知(判断待ちをメールで受け取る)

GitHub は**自分自身の操作を通知しない**。Routine はあなたのアカウントで Issue・PR を操作するため、Routine が作った Draft PR や判断依頼は、Watch 設定をどう変えてもそのままではメールが届かない。そこで `.github/workflows/notify-needs-decision.yml` が github-actions bot(= 別のアクター)として以下を行い、Participating 通知(メール)を発生させる:

| イベント | bot の動作 | 結果 |
| --- | --- | --- |
| Issue に `needs-decision` が付いた | あなたを assignee に追加 + @メンションコメント | メール通知 |
| Draft PR が作成された | あなたを assignee に追加 | メール通知(マージ判断 Issue が作られなかった場合の保険) |
| PR がマージ/クローズされた | 対応するマージ判断 Issue(本文の `<!-- merge-judgment-pr: N -->` マーカーで特定)を自動クローズ | 判断待ち一覧が自動で片付く |

前提条件: GitHub の [Settings → Notifications](https://github.com/settings/notifications) で「Participating, @mentions and custom」の Email が有効になっていること(既定で有効)。メールが届かない場合はまずここを確認する。

## パラメータ(チューニングポイント)

| パラメータ | 既定値 | 変える場所 |
| --- | --- | --- |
| WIP 上限(open な Draft PR 数) | 3 | SKILL.md 無人モード 手順0-1 |
| 消化ペース | 毎時1件 | Routine のスケジュール |

WIP 上限はレビューが追いつく範囲に保つ。未マージの Draft PR はすべて main 起点のため、溜まるほどマージのたびに他 PR がコンフリクトしやすくなる。

## 止め方・トラブル時

- **一時停止**: Routine を無効化する(claude.ai の Routines 画面)。実行中の fire には影響しない
- **着手したまま放置された Issue**(fire が異常終了した場合など): `status:in-progress` が付いているのに対応ブランチ/PR がなければ、ラベルを外せば次の fire が再度拾う
- **同じ Issue で撤退が繰り返される**: `needs-decision` の判断依頼コメントに回答し、`needs-decision` を外して `ready-to-implement` を付け直す。受け入れ条件そのものを `/issue-create` の基準(検証可能なチェックボックス)で書き直すのが根本対応
- **PR をマージしたのにマージ判断 Issue が残っている**: 通知ワークフローの自動クローズはマーカー `<!-- merge-judgment-pr: N -->` で対応 PR を特定する。マーカーが本文にない場合は手動でクローズする
