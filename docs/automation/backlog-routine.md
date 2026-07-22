# バックログ自動消化 Routine

`ready-to-implement` ラベル付きの Issue を、Claude Code の Routine(定期実行・fire ごとに fresh session)で1件ずつ無人実装し、Draft PR まで進める仕組み。実装手順の本体は `.claude/skills/issue-work/SKILL.md` の「無人モード」節にあり、このドキュメントはその運用(ラベル・Routine 設定・スロットル)を定める。

## 全体像

```
人間: Issue に ready-to-implement を付与(着手承認。依存の順序もここで担保)
  ↓
Routine(毎時 fire・fresh session): 無人モードで /issue-work
  ├─ WIP 上限超過 or 候補なし → 何もせず終了
  └─ 1件選定 → status:in-progress で排他ロック → 実装 → /verify → /ddd-review → Draft PR
  ↓
人間: Draft PR をレビューしてマージ(これが実質のスロットル)
```

設計原則:

- **1 fire = 1 Issue = 1 fresh session** — セッションの長時間化によるコンテキスト劣化を避ける。複数件の消化は fire の回数で稼ぐ(毎時 fire なら1日最大〜24件)
- **人間の承認は「着手前のラベル付け」に前倒し** — `ready-to-implement` を付ける行為が着手承認。無人モードは承認済みの Issue にしか触れない
- **Draft PR で止める** — マージ判断は必ず人間。自動マージはしない

## ラベル運用

| ラベル | 付ける人 | 意味 |
| --- | --- | --- |
| `ready-to-implement` | 人間 | 無人実装してよい(受け入れ条件が明確で、依存する先行 Issue がすべてクローズ済み) |
| `status:in-progress` | 無人モード | 着手中(fire 間の排他ロック)。対話モードの着手宣言と共通 |
| `needs-clarification` | 無人モード | 受け入れ条件が曖昧で撤退した。Issue のコメントに確認事項あり。人間が回答して `ready-to-implement` を付け直すまで対象外 |

ラベルの初回作成(冪等):

```bash
gh label create "ready-to-implement" --color 0E8A16 --description "無人実装してよい" 2>/dev/null || true
gh label create "needs-clarification" --color D93F0B --description "受け入れ条件の確認待ち" 2>/dev/null || true
```

## Routine のセットアップ

[claude.ai](https://claude.ai) の Claude Code → Routines から作成する(Routine はクラウド側で動くため、手元のセッションや PC の状態に依存しない)。

- **Environment**: このリポジトリ(`koki-ishikawa-aforce/IshikawaFinanceApp`)を含む環境。ネットワークポリシーは `gh` と pnpm install が通る設定にする
- **Trigger**: Schedule、毎時(消化ペースを落としたい場合は間隔を広げる)
- **Session**: fire ごとに新規セッション
- **Prompt**(そのまま貼り付け):

  ```
  無人モードで /issue-work を実行してください。

  - ready-to-implement ラベル付きの open Issue から1件だけ選んで実装し、Draft PR の作成まで行ってください
  - WIP 上限・排他ロック・曖昧なときの撤退・Draft PR 化は .claude/skills/issue-work/SKILL.md の「無人モード」節に従ってください
  - 着手できる Issue がない場合(WIP 上限超過・候補なし)は、リポジトリに一切変更を加えず理由だけ報告して終了してください
  ```

## パラメータ(チューニングポイント)

| パラメータ | 既定値 | 変える場所 |
| --- | --- | --- |
| WIP 上限(open な Draft PR 数) | 3 | SKILL.md 無人モード 手順0-1 |
| 消化ペース | 毎時1件 | Routine のスケジュール |

WIP 上限はレビューが追いつく範囲に保つ。未マージの Draft PR はすべて main 起点のため、溜まるほどマージのたびに他 PR がコンフリクトしやすくなる。

## 止め方・トラブル時

- **一時停止**: Routine を無効化する(claude.ai の Routines 画面)。実行中の fire には影響しない
- **着手したまま放置された Issue**(fire が異常終了した場合など): `status:in-progress` が付いているのに対応ブランチ/PR がなければ、ラベルを外せば次の fire が再度拾う
- **同じ Issue で撤退が繰り返される**: `needs-clarification` のコメントに回答し、`ready-to-implement` を付け直す。受け入れ条件そのものを `/issue-create` の基準(検証可能なチェックボックス)で書き直すのが根本対応
