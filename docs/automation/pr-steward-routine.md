# PR 執事 Routine

Routine が無人モードで作成した open PR を定期巡回し、CI 失敗の修復・コンフリクト解消・重複検知を行う仕組み。手順の本体は `.claude/skills/pr-steward/SKILL.md` にあり、このドキュメントはその運用（Routine 設定・スコープ・制約）を定める。

## 全体像

```
Routine(定期 fire): /pr-steward を実行
  ├─ 対象 PR なし → 何もせず終了
  ├─ CI 失敗あり → 診断 → 修正 push → /verify → CI green 確認（最大3回リトライ）
  ├─ コンフリクトあり → base ブランチをマージして解消 → /verify → push
  ├─ 重複 PR 検知 → needs-decision で人間に委ねる（自動クローズはしない）
  └─ 全 PR green → 報告して終了
  ↓
人間: needs-decision の一覧から判断し、PR をレビューしてマージ
```

設計原則:

- **マージは絶対に行わない** — PR 執事の仕事は「PR を green にする」まで。マージ判断は人間が行う（`/decide` セッション内の明示承認か、ユーザー自身の操作）
- **自動クローズはしない** — 重複 PR や対象 Issue がクローズ済みの場合も `needs-decision` で人間に委ねる
- **対象は Routine 起点の PR のみ** — 人間が手動で作成した PR には触れない（PR 本文の「無人モードの選定理由」セクションで判別）
- **修正は `/verify` 経由** — CI 修復・コンフリクト解消の push 前に必ず `/verify` 全 green を確認する
- **リトライ上限** — 同一エラーで3回修正に失敗したらマージ判断 Issue に記録して次の PR へ進む

## Routine のセットアップ

[claude.ai](https://claude.ai) の Claude Code → Routines から作成する。

- **Environment**: このリポジトリ（`koki-ishikawa-aforce/IshikawaFinanceApp`）を含む環境。バックログ Routine と同じ環境を使える
- **Trigger**: Schedule（バックログ Routine と異なる間隔を推奨。例: 2〜4時間ごと、または手動 fire）
- **Session**: fire ごとに新規セッション
- **Prompt**（そのまま貼り付け）:

  ```
  /pr-steward を実行してください。

  - Routine が無人モードで作成した open PR を巡回し、CI 失敗の修復・コンフリクト解消・重複検知を行ってください
  - 手順は .claude/skills/pr-steward/SKILL.md に従ってください
  - マージは絶対に行わないでください（マージ判断は人間が行います）
  - 重複 PR を検知した場合は自動クローズせず needs-decision で人間に委ねてください
  ```

## バックログ Routine との関係

| Routine | 役割 | 作るもの |
| --- | --- | --- |
| バックログ Routine (`/issue-work` 無人モード) | Issue → 実装 → PR 作成 → CI green 確認 | PR + マージ判断 Issue |
| PR 執事 Routine (`/pr-steward`) | 既存 PR の保守（CI 修復・コンフリクト解消） | 修正 commit（PR は既存） |

バックログ Routine は PR 作成後に同一 fire 内で CI green を確認するが、以下のケースで CI が赤いまま残ることがある:

- fire のセッション寿命が尽きて CI を待ち切れなかった
- CI 修正に3回失敗して撤退した
- CI green 後に別の PR のマージでコンフリクトが発生した

PR 執事はこれらの「取りこぼし」を拾い、人間の仕事をマージ判断だけに絞る。

## 止め方

- **一時停止**: Routine を無効化する（claude.ai の Routines 画面）
- **手動 fire**: Routine の fire ボタンで任意のタイミングで実行できる
