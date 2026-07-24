# PR 執事 Routine

Routine が無人モードで作成した open PR を定期巡回し、CI 失敗の修復・コンフリクト解消・重複検知を行い、あわせてマージ/クローズ済み PR のスクリーンショット残骸(`docs/pr-screenshots/`)を掃除する仕組み。手順の本体は `.claude/skills/pr-steward/SKILL.md` にあり、このドキュメントはその運用(Routine 設定・スコープ・制約)を定める。

## 全体像

```
Routine(定期 fire): /pr-steward を実行
  ├─ 対象 PR なし → スクリーンショット掃除だけ行って終了
  ├─ CI 失敗あり → 診断 → 修正 push → /verify → CI green 確認(最大3回リトライ)
  ├─ コンフリクトあり(mergeable 状態で機械判定) → base ブランチをマージして解消 → /verify → push
  ├─ 重複 PR 検知 → needs-decision で人間に委ねる(自動クローズはしない)
  ├─ スクリーンショット掃除 → マージ/クローズ済み PR の残骸 PNG を削除する PR を作成(マージは人間)
  └─ 全 PR green → 報告して終了
  ↓
人間: needs-decision の一覧から判断し、PR をレビューしてマージ
```

設計原則:

- **マージは絶対に行わない** — PR 執事の仕事は「PR を green にする」と「スクリーンショット残骸の削除 PR を作る」まで。マージ判断は人間が行う(`/decide` セッション内の明示承認か、ユーザー自身の操作)。スクリーンショット削除 PR も同じ
- **自動クローズはしない** — 重複 PR や対象 Issue がクローズ済みの場合も `needs-decision` で人間に委ねる
- **対象は Routine 起点の PR のみ** — 人間が手動で作成した PR には触れない(PR 本文の「無人モードの選定理由」セクション・head ブランチ名・マージ判断 Issue の有無で判別)
- **修正は `/verify` 経由** — CI 修復・コンフリクト解消の push 前に必ず `/verify` 全 green を確認する
- **リトライ上限** — 同一エラーで3回修正に失敗したらマージ判断 Issue に記録して次の PR へ進む
- **購読は最小限** — `subscribe_pr_activity` は修正 push 後の CI 待ちに限って使い、fire 終了前に解除する(fire ごとの fresh session が全 PR を購読すると、終了済みセッション宛ての購読が蓄積するため)

## Routine のセットアップ

[claude.ai](https://claude.ai) の Claude Code → Routines から作成する。

- **Environment**: このリポジトリ(`koki-ishikawa-aforce/IshikawaFinanceApp`)を含む環境。バックログ Routine と同じ環境を使える
- **Trigger**: Schedule(バックログ Routine と異なる間隔を推奨。例: 2〜4時間ごと、または手動 fire)
- **Session**: fire ごとに新規セッション
- **Prompt**(そのまま貼り付け):

  ```
  /pr-steward を実行してください。

  - Routine が無人モードで作成した open PR を巡回し、CI 失敗の修復・コンフリクト解消・重複検知を行ってください
  - 手順は .claude/skills/pr-steward/SKILL.md に従ってください
  - マージは絶対に行わないでください(マージ判断は人間が行います)
  - 重複 PR を検知した場合は自動クローズせず needs-decision で人間に委ねてください
  ```

## バックログ Routine との関係

| Routine | 役割 | 作るもの |
| --- | --- | --- |
| バックログ Routine (`/issue-work` 無人モード) | Issue → 実装 → PR 作成 → CI green 確認。preflight で Routine 起点 open PR のコンフリクトも先解消 | PR + マージ判断 Issue / コンフリクト解消 commit |
| PR 執事 Routine (`/pr-steward`) | 既存 PR の保守(CI 修復・コンフリクト解消)+ スクリーンショット残骸の掃除 | 修正 commit(PR は既存)/ スクリーンショット削除 PR(新規) |

**コンフリクト解消は2か所が担う**。毎時のバックログ Routine が preflight で先解消するため放置時間の上限は最長でも fire 間隔（Routine の登録数とスケジュールに依存）に収まり、PR 執事 Routine はより広い間隔で CI 修復とあわせて保守する。どちらもコンフリクト判定は mergeable 状態で機械的に行い(`mergeable == CONFLICTING` / `mergeable_state == dirty`)、`unknown`(計算中)は数秒待って再照会する。**マージは両者とも行わない**。

2か所が同じ PR ブランチをほぼ同時に修復すると、片方の push が non-fast-forward(リモートが先に進んでいて早送りできない状態)で拒否されうる。拒否されたセッションはリモートを fetch し直して mergeable を再確認し、**既に別セッションが解消済みなら何もせず次へ進む**。まだコンフリクトが残る場合のみ取り直した head に base を再度マージして1回だけやり直し、それでも失敗したらその PR の解消を保留して完了報告に記す(競合時の詳細手順は `.claude/skills/issue-work/SKILL.md` のコンフリクト修復 preflight と `.claude/skills/pr-steward/SKILL.md` 手順2c に定義)。

バックログ Routine は PR 作成後に同一 fire 内で CI green を確認するが、以下のケースで CI が赤いまま残ることがある:

- fire のセッション寿命が尽きて CI を待ち切れなかった
- CI 修正に3回失敗して撤退した
- CI green 後に別の PR のマージでコンフリクトが発生した

PR 執事はこれらの「取りこぼし」を拾い、人間の仕事をマージ判断だけに絞る。

## 止め方

- **一時停止**: Routine を無効化する(claude.ai の Routines 画面)
- **手動 fire**: Routine の fire ボタンで任意のタイミングで実行できる
