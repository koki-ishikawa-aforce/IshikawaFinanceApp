# 振り返り Routine(retro)

無人運用(Routine による `/issue-work` / `/pr-steward`)が毎回捨てている失敗データ(撤退・CI リトライ・レビュー指摘・マージまでの往復)を、Claude Code の Routine(定期実行・fire ごとに fresh session)で週次に振り返り、繰り返す失敗パターンから改善案を導出して `needs-decision` Issue に起票する仕組み。手順の本体は `.claude/skills/retro/SKILL.md` にあり、このドキュメントはその運用(Routine 設定・スコープ・スロットル)を定める。

## 全体像

```
Routine(週次 fire・fresh session): /retro を実行
  ├─ 収集期間の決定(既定: 直近1週間)
  ├─ データ収集: マージ済み/クローズ PR・needs-decision Issue・撤退記録・CI 落ち・レビュー指摘
  ├─ 失敗パターンの抽出(2回以上の再発、または再発時の手戻りが大きいもの)
  ├─ 改善案の導出(反映先: skills / CLAUDE.md / .github/ISSUE_TEMPLATE / docs/automation / docs/workflow)
  ├─ ワークフロー全体の点検(docs/workflow/05-criteria.md の基準に照らした評価、04-principles.md の原則・未解決課題との突合、改善ループの滞留観測)
  └─ 改善案あり → needs-decision Issue として起票(1改善 = 1 Issue)
     改善案なし → 何も起票せず報告のみ
  ↓
人間: /decide で改善案を採否判断
  ├─ 採用 → needs-decision を外し ready-to-implement を付ける → 次の /issue-work fire が実装
  └─ 見送り → Issue を閉じる
```

設計原則:

- **読み取り専用 — retro 自身はコードも docs も変更しない** — 成果物は「改善案の Issue」だけ。実際の改善は起票 → `/decide` で承認 → 別 fire の `/issue-work` が実装、という既存フローに乗せる。振り返りと実装を分離することで、自己改善が承認ゲート(人間の判断)を素通りしないようにする
- **人間の判断は needs-decision に集約する** — 改善案は `needs-decision` ラベル付き Issue にする。判断待ちの全量は [`is:issue is:open label:needs-decision`](https://github.com/koki-ishikawa-aforce/IshikawaFinanceApp/issues?q=is%3Aissue+is%3Aopen+label%3Aneeds-decision) で一覧でき、ラベル付与をトリガーに通知ワークフロー(`.github/workflows/notify-needs-decision.yml`)がメールを発生させる。消化は `/decide`(`.claude/skills/decide/SKILL.md`)で行う
- **空振りを許容する** — 再発パターンが無い週は何も起票しない。改善案を無理に捻り出さない。振り返りの価値は「捨てていた失敗データを可視化すること」にあり、毎週 Issue を作ることではない
- **証拠ベース・保守的** — 単発事象はパターンとして扱わない。2 回以上の再発、または 1 回でも再発時の手戻りが大きい失敗のみを起票対象にし、改善案には必ず根拠(どの PR/Issue で・何回起きたか)を添える
- **1 改善 = 1 Issue** — 関連する改善もまとめず個別に起票する。`/decide` で採用分だけ `ready-to-implement` に付け替えられるようにするため

## バックログ Routine・PR 執事 Routine との関係

| Routine | 役割 | 作るもの | 対象データ |
| --- | --- | --- | --- |
| バックログ Routine(`/issue-work` 無人モード) | Issue → 実装 → PR 作成 → CI green 確認 → マージ | PR + マージ | ready-to-implement な Issue |
| PR 執事 Routine(`/pr-steward`) | 既存 PR の保守(CI 修復・コンフリクト解消) | 修正 commit | open な Routine 起点 PR |
| 振り返り Routine(`/retro`) | 上記2つの運用の失敗とワークフロー全体(`docs/workflow`)を振り返り、自己改善案を導出 | 改善案 Issue(needs-decision) | 直近期間の PR・needs-decision Issue・撤退記録・CI 落ち |

バックログ Routine と PR 執事 Routine が「1 件ずつ前に進める」実務を担うのに対し、振り返り Routine は「その実務の失敗を次の改善につなげる」メタなループを担う。retro が起票した改善案が `/issue-work` で実装されると、次の retro が拾う失敗が減っていく(自己改善ループ)。

## 収集対象

`/retro` は直近期間(既定 1 週間)について以下を収集する(詳細は `.claude/skills/retro/SKILL.md` 手順2):

- **マージ済み / クローズされた PR**(Routine 起点): 期間内に作成された PR に加え、起点より前に作られて期間内にマージ / クローズされた PR(長く滞留した PR ほど失敗データとして重要)も対象にする。マージまでの往復回数、却下理由、本文の異常(リテラル `\n`・`Closes #` の番号欠落)
- **`needs-decision` Issue / PR**(open + 直近クローズ): 種別(`main` 赤 / マージ保留 PR / 見送り追認 / 撤退時の確認)ごとの偏り、特に撤退理由の集中
- **自動マージの失敗**: マージゲートのどの条件で PR が止まったかの偏り、`[main 赤]` の発生件数と原因(ローカル `/verify` と CI の乖離 / semantic conflict)
- **撤退記録**: 元 Issue のコメントに残る撤退理由。同じ Issue での撤退の反復
- **CI 落ちの類型**: どのジョブ(build / typecheck / test / lint / format:check / 統合テスト)が繰り返し落ちているか
- **レビュー指摘の再発**: 同種の `/ddd-review` must-fix / suggestion が複数 PR に出続けていないか

収集した失敗データは、個別パターンの抽出に加えて**ワークフロー全体の点検**にも使う(SKILL.md 手順5): `docs/workflow/05-criteria.md` の基準の「測り方」に沿って今期間を観測して現状評価の改訂案を出し、`docs/workflow/04-principles.md` の原則・未解決課題と突合してワークフロー仕様そのものの改訂案を導出し、`[改善案]` Issue の起票数と消化数の乖離(改善ループの滞留)も観測する。

## Routine のセットアップ

[claude.ai](https://claude.ai) の Claude Code → Routines から作成する(Routine はクラウド側で動くため、手元のセッションや PC の状態に依存しない)。

**登録状況**: 2026-08-24 に MCP の `create_trigger` 経由で登録済み(trigger ID `trig_012pUP3cwugfkkhVysLveL38`)。

- **Environment**: このリポジトリ(`koki-ishikawa-aforce/IshikawaFinanceApp`)を含む環境。バックログ Routine と同じ環境を使える。ネットワークポリシーは GitHub 操作が通る設定にする(`gh` CLI が無い環境でも GitHub MCP ツールで動くよう、スキル側にフォールバックを定めている)
- **Trigger**: Schedule、週次(例: 毎週月曜の朝)。現在は UTC で `0 0 * * 1`(= 月曜 09:00 JST)。バックログ Routine(2時間おき)より十分に長い間隔にする — 1 週間分の運用データが溜まってから振り返るため
- **Session**: fire ごとに新規セッション
- **Prompt**(そのまま貼り付け):

  ```
  /retro を実行してください。

  - 手順は .claude/skills/retro/SKILL.md に従ってください(収集期間・失敗パターンの抽出・ワークフロー全体の点検・起票の基準とテンプレートまで、すべてそこが正です)
  - 最終的な報告は日本語を使ってください。
  ```

  プロンプトは薄く保っている(2026-08-25 に移行済み)ため、手順の変更は `SKILL.md` を直せば次の fire から自動で反映される。プロンプト自体を変える場合は Routine 側を直すまで反映されない — この Routine は MCP の `create_trigger` で作ったため `update_trigger` で直せる(**画面で作成した Routine は Claude からは更新も停止もできない**。経路の一覧は `backlog-routine.md`「プロンプトは薄く保つ」)。

  **注意**: Routine の実際の作成(トリガー登録)はリポジトリの変更(このドキュメントの追加)には含まれない。登録は claude.ai の Routines 画面、または MCP の `create_trigger` で別途行う。

## 通知(改善案をメールで受け取る)

GitHub は**自分自身の操作を通知しない**。retro Routine もあなたのアカウントで Issue を操作するため、起票した改善案は Watch 設定だけではメールが届かない。バックログ Routine と同じく、`.github/workflows/notify-needs-decision.yml` が github-actions bot(= 別のアクター)として、`needs-decision` が付いた Issue にあなたを assignee 追加 + @メンションコメントし、Participating 通知(メール)を発生させる。前提条件・詳細は `docs/automation/backlog-routine.md` の「通知」節を参照。

## パラメータ(チューニングポイント)

| パラメータ | 既定値 | 変える場所 |
| --- | --- | --- |
| 収集期間 | 直近1週間 | `/retro` 呼び出し時の指定、または SKILL.md 手順1 |
| 振り返りペース | 週次 | Routine のスケジュール |
| 起票のしきい値 | 2回以上の再発、または再発時の手戻りが大きい失敗 | SKILL.md 手順3 |

## 止め方・トラブル時

- **一時停止**: Routine を無効化する(claude.ai の Routines 画面)。実行中の fire には影響しない
- **改善案が的外れ / 過剰**: `/decide` で見送って Issue を閉じればよい(retro は読み取り専用のため、起票以外の副作用はない)。頻発するようなら SKILL.md 手順3 の起票しきい値を厳しくする
- **改善案 Issue が溜まる**: `/decide` で採否をまとめて消化する。採用分は `ready-to-implement` に付け替えるとバックログ Routine が実装として拾う
