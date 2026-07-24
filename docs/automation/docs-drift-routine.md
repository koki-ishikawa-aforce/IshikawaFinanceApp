# ドキュメント乖離検知 Routine(docs-drift)

`docs/domain`(集約定義・ユビキタス言語・公開 API 一覧)と `packages/domain` のコードの乖離を、Claude Code の Routine(定期実行・fire ごとに fresh session)で週次に検知し、乖離を Issue として起票する仕組み。手順の本体は `.claude/skills/docs-drift/SKILL.md` にあり、このドキュメントはその運用(Routine 設定・スコープ)を定める。

## 全体像

```
Routine(週次 fire・fresh session): /docs-drift を実行
  ├─ 突合 A: packages/domain/README.md の公開 API 一覧 ↔ barrel export
  ├─ 突合 B: docs/domain/09-aggregates.md の集約定義 ↔ aggregates/ 実装
  ├─ 突合 C: docs/domain/08*.md の UL 用語 ↔ コード上の命名
  └─ 乖離あり → Issue として起票(1 乖離 = 1 Issue)
     乖離なし → 何も起票せず報告のみ
  ↓
人間: /decide で修正方針を判断
  ├─ docs を直す → ready-to-implement を付ける → 次の /issue-work fire が修正
  ├─ コードを直す → ready-to-implement を付ける → 次の /issue-work fire が修正
  └─ 乖離ではない(意図的な差異) → Issue を閉じる
```

設計原則:

- **読み取り専用 — docs-drift 自身はコードも docs も変更しない** — 成果物は「乖離を報告する Issue」だけ。修正は起票 → `/decide` で承認 → 別 fire の `/issue-work` が実装、という既存フローに乗せる
- **機械的に突合する** — export 名・型名・イベント名・集約名などの文字列一致で乖離を検出する。曖昧な言い回しの違いは乖離として扱わない
- **空振りを許容する** — 乖離が無い週は何も起票しない。無理に乖離を探さない
- **1 乖離 = 1 Issue** — 関連する乖離もまとめず個別に起票する。`/decide` で個別に修正方針を判断できるようにするため
- **docs とコードのどちらが正かは判断しない** — 事実(「docs にはあるがコードにない」等)と修正方針案の両選択肢を Issue に記載し、人間が判断する

## バックログ Routine・振り返り Routine との関係

| Routine | 役割 | 作るもの | 対象データ |
| --- | --- | --- | --- |
| バックログ Routine(`/issue-work` 無人モード) | Issue → 実装 → PR 作成 → CI green 確認 | PR + マージ判断 Issue | ready-to-implement な Issue |
| 振り返り Routine(`/retro`) | 無人運用の失敗を振り返り、自己改善案を導出 | 改善案 Issue(needs-decision) | 直近期間の PR・撤退記録・CI 落ち |
| 乖離検知 Routine(`/docs-drift`) | docs とコードの乖離を定期検知 | 乖離報告 Issue(ready-to-implement または needs-decision) | docs/domain と packages/domain/src |

バックログ Routine が「Issue を実装する」実務を担うのに対し、乖離検知 Routine は「ドキュメントとコードの整合性を維持するための Issue を生成する」予防的な仕組み。`/ddd-review` が PR 単位の差分から乖離を防ぐのに対し、`/docs-drift` は蓄積した乖離をリポジトリ全体から検出する。

## 突合対象

`/docs-drift` は以下の 3 つの突合を行う(詳細は `.claude/skills/docs-drift/SKILL.md` 手順 2〜4):

- **突合 A: 公開 API 一覧 ↔ barrel export** — `packages/domain/README.md` に列挙された export 名と、`packages/domain/src/**/index.ts` の実際の barrel export を照合する。README への追記漏れや、削除・リネーム後の README 未更新を検出する
- **突合 B: 集約定義 ↔ 実装** — `docs/domain/09-aggregates.md` の集約候補リスト(集約ルート名・不変条件・集約内 data)と、`packages/domain/src/*/aggregates/` 配下の実装(Zod スキーマ・`superRefine`)を照合する。集約・値オブジェクト・イベントの追加・削除・リネームを検出する
- **突合 C: ユビキタス言語 ↔ コード命名** — `docs/domain/08a`〜`08h` のユビキタス言語ドキュメント(日本語名と英語名)と、対応する BC のコード上の型名・関数名を照合する。UL 定義の欠落やコード命名との不一致を検出する

## Routine のセットアップ

[claude.ai](https://claude.ai) の Claude Code → Routines から作成する(Routine はクラウド側で動くため、手元のセッションや PC の状態に依存しない)。

- **Environment**: このリポジトリ(`koki-ishikawa-aforce/IshikawaFinanceApp`)を含む環境。バックログ Routine と同じ環境を使える。ネットワークポリシーは GitHub 操作が通る設定にする(`gh` CLI が無い環境でも GitHub MCP ツールで動くよう、スキル側にフォールバックを定めている)
- **Trigger**: Schedule、週次(例: 毎週水曜の朝)。バックログ Routine(毎時)や振り返り Routine(毎週月曜)とずらすのが望ましい — 振り返りが拾う失敗データとドキュメント乖離は独立した関心事のため、曜日を分散させて負荷を分ける
- **Session**: fire ごとに新規セッション
- **Prompt**(そのまま貼り付け):

  ```
  /docs-drift を実行してください。

  - docs/domain(集約定義・ユビキタス言語・公開 API 一覧)と packages/domain のコードの乖離を検知してください
  - 手順は .claude/skills/docs-drift/SKILL.md に従ってください
  - 検知した乖離はコードも docs も変更せず、乖離内容と修正方針案を記した Issue として起票してください(1 乖離 = 1 Issue)
  - docs とコードのどちらが正かが自明な場合は ready-to-implement、判断が必要な場合は needs-decision を付けてください
  - 乖離が見つからなかった場合は、何も起票せず突合結果だけを報告して終了してください
  ```

  プロンプトを変更した場合は、claude.ai 側の Routine に貼り直すまで反映されない(Routine のプロンプトはリポジトリからは変更できない)。

  **注意**: Routine の実際の作成(トリガー登録)は claude.ai 側の操作であり、リポジトリの変更(このドキュメントの追加)には含まれない。

## 通知(乖離報告をメールで受け取る)

GitHub は**自分自身の操作を通知しない**。docs-drift Routine もあなたのアカウントで Issue を操作するため、起票した乖離報告は Watch 設定だけではメールが届かない。`needs-decision` を付与した Issue は、バックログ Routine と同じく `.github/workflows/notify-needs-decision.yml` が github-actions bot(= 別のアクター)として assignee 追加 + @メンションコメントし、Participating 通知(メール)を発生させる。`ready-to-implement` のみの Issue は通知ワークフローの対象外だが、次のバックログ Routine fire が自動で拾って実装するため、人間への通知は不要。前提条件・詳細は `docs/automation/backlog-routine.md` の「通知」節を参照。

## パラメータ(チューニングポイント)

| パラメータ | 既定値 | 変える場所 |
| --- | --- | --- |
| 検査ペース | 週次 | Routine のスケジュール |
| 突合対象 | A(公開 API)・B(集約定義)・C(UL 用語) | SKILL.md 手順 1 |
| ready-to-implement の自動判定 | docs/コードのどちらが正かが自明な場合 | SKILL.md 手順 5 |

## 止め方・トラブル時

- **一時停止**: Routine を無効化する(claude.ai の Routines 画面)。実行中の fire には影響しない
- **乖離報告が過剰 / 的外れ**: `ready-to-implement` が付いた乖離は自動で実装されるため、不要な乖離報告が `ready-to-implement` で起票されていないか確認する。的外れな報告が続く場合は SKILL.md の突合ロジック(手順 2〜4)を見直す
- **乖離報告 Issue が溜まる**: `needs-decision` の分は `/decide` で方針を判断する。`ready-to-implement` の分はバックログ Routine が順次消化する
- **同じ乖離が毎週起票される**: SKILL.md 手順 5 の重複チェックで防止されるが、既存 Issue のタイトルが異なる場合は重複を検出できないことがある。手動で重複 Issue を閉じれば次回以降は検出されない
