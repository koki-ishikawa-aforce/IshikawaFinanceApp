# 体系駆動レビュー Routine(workflow-review)

`/retro`(失敗データ駆動・週次)が構造的に検出できない「動いていない工程の欠落」(CD・監視・設計工程など)を、Claude Code の Routine(定期実行・fire ごとに fresh session)で四半期に振り返り、ライフサイクル網羅表(`docs/workflow/06-lifecycle-coverage.md`)と外部の知識体系ポートフォリオ(SWEBOK v4 / DORA / AWS Well-Architected / OWASP SAMM)をリポジトリの実体と突合して `[改善案]` + `needs-decision` Issue を起票する仕組み。手順の本体は `.claude/skills/workflow-review/SKILL.md` にあり、このドキュメントはその運用(Routine 設定・スコープ)を定める。

## 全体像

```
Routine(四半期 fire・fresh session): /workflow-review を実行
  ├─ 前回実施記録(docs/workflow/research/)の確認・前回からの進捗把握
  ├─ 網羅表(06-lifecycle-coverage.md)との突合(状態のずれ・新しい欠落の有無)
  ├─ ポートフォリオ各体系のチェックリスト突合(DORA Four Keys / AWS WA / OWASP SAMM)
  ├─ /retro との重複回避チェック(失敗データ由来の改善案は扱わない)
  ├─ 乖離・欠落あり → [改善案] + needs-decision Issue として起票(1乖離・欠落 = 1 Issue)
  │  乖離・欠落なし → Issue は起票せず報告のみ
  └─ 実施記録を docs/workflow/research/ に追加(PR 経由。マージゲート対象外・人間の確認待ち)
  ↓
人間: PR をレビューして直接マージ(記録の追加を確定)
人間: /decide で [改善案] Issue の採否を判断
  ├─ 採用 → needs-decision を外し ready-to-implement を付ける → 次の /issue-work fire が実装
  └─ 見送り → Issue を閉じる
```

設計原則:

- **読み取り専用(実施記録の追加を除く)** — workflow-review 自身は既存のコード・docs を変更しない。成果物は「`[改善案]` Issue」と「実施記録ファイル1点(PR 経由)」だけ。実際の改善は起票 → `/decide` で承認 → 別 fire の `/issue-work` が実装、という既存フローに乗せる
- **`/retro` と直交する** — `/retro` は失敗データ(撤退・CI リトライ・レビュー指摘の再発)を振り返るのに対し、本 Routine は失敗データを一切扱わず、外部の知識体系とライフサイクル網羅表を物差しにした構造監査を行う。動いていない工程(CD・監視など)は失敗データを生まないため `/retro` には見えないが、体系駆動の突合であれば「未整備」として検出できる
- **人間の判断は needs-decision に集約する** — 改善案は `needs-decision` ラベル付き Issue にする。判断待ちの全量は [`is:issue is:open label:needs-decision`](https://github.com/koki-ishikawa-aforce/IshikawaFinanceApp/issues?q=is%3Aissue+is%3Aopen+label%3Aneeds-decision) で一覧でき、ラベル付与をトリガーに通知ワークフロー(`.github/workflows/notify-needs-decision.yml`)がメールを発生させる。消化は `/decide`(`.claude/skills/decide/SKILL.md`)で行う
- **空振りを許容する** — 乖離・欠落が無い四半期は Issue を起票しない。実施記録ファイルは空振りの場合も残す(次回の突合材料になるため)
- **1 乖離・欠落 = 1 Issue** — 関連する改善もまとめず個別に起票する

## バックログ Routine・振り返り Routine・乖離検知 Routine との関係

| Routine | 役割 | 作るもの | 対象データ |
| --- | --- | --- | --- |
| バックログ Routine(`/issue-work` 無人モード) | Issue → 実装 → PR 作成 → CI green 確認 → マージ | PR + マージ | ready-to-implement な Issue |
| 振り返り Routine(`/retro`) | 無人運用(直近1週間)の失敗を振り返り、自己改善案を導出 | 改善案 Issue(needs-decision) | 直近期間の PR・needs-decision Issue・撤退記録・CI 落ち |
| 乖離検知 Routine(`/docs-drift`) | `docs/domain` とコード・実行基盤一覧の乖離を定期検知 | 乖離報告 Issue(ready-to-implement または needs-decision) | `docs/domain` と `packages/domain/src`、`docs/workflow` と `.claude` / `.github` |
| 体系駆動レビュー Routine(`/workflow-review`) | 外部知識体系とライフサイクル網羅表を物差しに、動いていない工程の欠落を検知 | 改善案 Issue(needs-decision)+ 実施記録(PR) | `docs/workflow/06-lifecycle-coverage.md`・DORA / AWS WA / OWASP SAMM のチェックリスト・リポジトリの実体 |

`/retro` が「直近の失敗から学ぶ」内側のループを担うのに対し、`/workflow-review` は「外部の物差しと照らして、まだ失敗すらしていない欠落を見つける」外側のループを担う。両者は収集するデータが完全に分離しており(失敗データ vs 体系突合)、同じ観点を2か所で見ない(`docs/review/README.md` §1-3 の原則)。

## 突合対象

`/workflow-review` は以下を突合する(詳細は `.claude/skills/workflow-review/SKILL.md` 手順2〜3):

- **網羅表突合**: `docs/workflow/06-lifecycle-coverage.md` の SWEBOK v4 18 KA 各行の「担保手段」「状態」が現在のリポジトリの実体と一致しているか(実装が進んだのに状態が古いまま・退行したのに ✅ のまま、の両方向)
- **DORA Four Keys**: `docs/workflow/05-criteria.md` 基準11「到達性」の現状評価が CD・監視・バックアップ関連 Issue の進捗を反映しているか
- **AWS Well-Architected**: 網羅表が引用する質問 ID(OPS 4/6/8・REL 9・REL 13・SEC06-BP01 等)の対策がリポジトリに実在するか
- **OWASP SAMM v2**: 15 プラクティスのうち既出のもの(Secure Deployment・Vulnerability Management 等)の L1 相当の実施有無

体系選定の根拠は [`docs/workflow/research/2026-08-27-lifecycle-frameworks.md`](../workflow/research/2026-08-27-lifecycle-frameworks.md) を参照(12体系を比較し、SWEBOK v4 を背骨、DORA・AWS Well-Architected・OWASP SAMM を補助物差しに採用)。

## Routine のセットアップ

[claude.ai](https://claude.ai) の Claude Code → Routines から作成する(Routine はクラウド側で動くため、手元のセッションや PC の状態に依存しない)。

**登録状況**: 未登録。本ドキュメントの追加時点では手順書の整備のみが完了しており、Routine 自体の登録(トリガー作成)は人間が別途行う(画面作業のため、リポジトリの変更には含まれない)。

- **Environment**: このリポジトリ(`koki-ishikawa-aforce/IshikawaFinanceApp`)を含む環境。他の Routine と同じ環境を使える。ネットワークポリシーは GitHub 操作が通る設定にする(`gh` CLI が無い環境でも GitHub MCP ツールで動くよう、スキル側にフォールバックを定めている)
- **Trigger**: Schedule、**四半期**(例: 1・4・7・10 月の第1月曜 朝)。バックログ Routine(2時間おき)・振り返り Routine(週次・月曜)・乖離検知 Routine(週次・水曜)よりも十分に長い間隔にする — 体系駆動の監査は四半期単位の構造変化を見るものであり、週次で回しても差分が乏しく空振りが増えるだけになる
- **Session**: fire ごとに新規セッション
- **モデル**: 可能であれば、通常のバックログ Routine とは**別モデル**での実行を推奨する。理由は2つ。(1) 外部知識体系を物差しにした構造監査は、実装作業とは異なる「俯瞰して欠落を見つける」性質の判断であり、多様な視点を混ぜることで見落としを減らせる可能性がある。(2) 四半期に1回程度の低頻度な実行であり、コスト面の制約が相対的に緩い。固定のモデル名はここに記載しない(モデルのラインナップは変わるため、Routine 作成時に利用可能な選択肢から選ぶ)
- **Prompt**(そのまま貼り付け):

  ```
  /workflow-review を実行してください。

  - 手順は .claude/skills/workflow-review/SKILL.md に従ってください(網羅表・ポートフォリオ突合の対象、/retro との責務分担、起票の基準とテンプレート、実施記録の保存まで、すべてそこが正です)
  - 最終的な報告は日本語を使ってください。
  ```

  プロンプトは薄く保つ(他の Routine と同じ方針)。手順の変更は `SKILL.md` を直せば次の fire から自動で反映される。プロンプト自体を変える場合は Routine 側を直すまで反映されない(経路の一覧は `backlog-routine.md`「プロンプトは薄く保つ」)。

  **注意**: Routine の実際の作成(トリガー登録)はリポジトリの変更(このドキュメントの追加)には含まれない。登録は claude.ai の Routines 画面、または MCP の `create_trigger` で別途行う。

## 通知(改善案をメールで受け取る)

GitHub は**自分自身の操作を通知しない**。workflow-review Routine もあなたのアカウントで Issue を操作するため、起票した改善案は Watch 設定だけではメールが届かない。他の Routine と同じく、`.github/workflows/notify-needs-decision.yml` が github-actions bot(= 別のアクター)として、`needs-decision` が付いた Issue にあなたを assignee 追加 + @メンションコメントし、Participating 通知(メール)を発生させる。前提条件・詳細は `docs/automation/backlog-routine.md` の「通知」節を参照。

実施記録を追加する PR は**マージゲートの対象外**であり自動マージされない。`notify-pr-opened` によりオーナーが assign され、PR 作成時にメール通知が届く(他の Routine 起点 PR と同じ通知経路)。この PR は人間が内容を確認して直接マージする。

## パラメータ(チューニングポイント)

| パラメータ | 既定値 | 変える場所 |
| --- | --- | --- |
| 実施ペース | 四半期 | Routine のスケジュール |
| 突合対象(網羅表・ポートフォリオ体系) | `06-lifecycle-coverage.md` + DORA / AWS WA / OWASP SAMM | SKILL.md 手順2〜3 |
| 起票のしきい値 | 網羅表・チェックリストの項目に根拠がある乖離・欠落のみ | SKILL.md 手順5 |
| 実行モデル | 既定(バックログ Routine と同一) | Routine 作成画面(別モデル推奨。上記「Routine のセットアップ」参照) |

## 止め方・トラブル時

- **一時停止**: Routine を無効化する(claude.ai の Routines 画面)。実行中の fire には影響しない
- **改善案が的外れ / 過剰**: `/decide` で見送って Issue を閉じればよい(workflow-review は Issue 起票と実施記録の追加以外に副作用を持たない)。頻発するようなら SKILL.md 手順5 の起票基準を厳しくする
- **実施記録の PR が溜まる**: 四半期に1回しか作られないため通常は問題にならないが、レビューが遅れる場合は内容を確認して直接マージする(マージゲートの対象外のため、他の自動マージ済み PR との整合を気にする必要はない)
- **改善案 Issue が溜まる**: `/decide` で採否をまとめて消化する。採用分は `ready-to-implement` に付け替えるとバックログ Routine が実装として拾う
