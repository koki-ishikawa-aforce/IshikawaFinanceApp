---
name: docs-drift
description: docs/domain とコードの乖離検知。読み取り専用で、コードも docs も変更せず、乖離を Issue として起票する。定期検査やドキュメントとコードの整合性確認を依頼されたときに使用する。
---

# ドキュメント乖離検知(docs-drift)

`docs/domain`(集約定義・ユビキタス言語・公開 API 一覧)とコードの乖離を検知し、Issue として起票する。読み取り専用で、コードも docs も変更しない。

運用(週次 Routine のセットアップ)は `docs/automation/docs-drift-routine.md` に定める。このスキルはその手順の本体を担う。

> **実行環境の注意**: 本書の `gh` コマンドは操作の意図を示すリファレンス。`gh` CLI が使えない環境(Claude Code on the web / Routine 起動セッションなど)では、GitHub MCP ツール(`mcp__github__*`: `search_issues` / `issue_write` / `add_issue_comment` など)で同等の操作を行う。どちらも使えない場合は GitHub 操作を伴う手順を実行できないため、その旨を報告して終了する。

## 設計原則

- **読み取り専用** — このスキルはコードも docs も変更しない。成果物は「乖離を報告する Issue」だけ。修正は起票した Issue を `/decide` で承認したうえで、別 fire の `/issue-work` が実装する
- **機械的に突合する** — 自然言語の解釈に頼らず、export 名・型名・イベント名・集約名などの文字列一致で乖離を検出する。曖昧な言い回しの違いは乖離として扱わない
- **空振りを許容する** — 乖離が見つからなければ何も起票せず、突合結果と「乖離なし」の報告だけで終える。無理に乖離を探さない
- **1 乖離 = 1 Issue** — 関連する乖離もまとめず個別に起票する。`/decide` で個別に採否を判断でき、採用分だけ `ready-to-implement` に付け替えられるため
- **docs とコードのどちらが正かは判断しない** — Issue には「docs にはあるがコードにない」「コードにはあるが docs にない」という事実と、修正方針案(docs 側を直す / コード側を直す)の両選択肢を記載する。どちらを直すかは人間が判断する

## 手順

### 1. 突合対象の確認

以下の 3 つの突合を順に行う:

| #   | 突合           | docs 側                        | コード側                                                                 |
| --- | -------------- | ------------------------------ | ------------------------------------------------------------------------ |
| A   | 公開 API 一覧  | `packages/domain/README.md`    | `packages/domain/src/**/index.ts`(barrel export)                         |
| B   | 集約定義       | `docs/domain/09-aggregates.md` | `packages/domain/src/*/aggregates/`・`value-objects/`・`events/`         |
| C   | ユビキタス言語 | `docs/domain/08*.md`(08a〜08h) | コード上の命名(集約・値オブジェクト・イベント・リポジトリ・クエリの型名) |

### 2. 突合 A: 公開 API 一覧 ↔ barrel export

1. `packages/domain/README.md` の「公開 API」セクションから、BC ごとに列挙されている export 名(型名・スキーマ名・関数名)を抽出する
2. `packages/domain/src/index.ts` → 各 BC の `index.ts` → 各サブディレクトリの `index.ts` を辿り、実際に barrel export されている名前を列挙する
3. 差分を取る:
   - **README にあるがコードに export がない** — docs が古い(削除・リネーム後に README 未更新)か、export 漏れ
   - **コードに export があるが README にない** — README への追記漏れ

### 3. 突合 B: 集約定義 ↔ 実装

1. `docs/domain/09-aggregates.md` の集約候補リスト(§1 のテーブル)から、各集約ルート名・不変条件・集約内 data を抽出する
2. `packages/domain/src/*/aggregates/` 配下の実装から、集約のスキーマ定義(Zod)・状態遷移関数・不変条件(`superRefine` 等)を読み取る
3. 差分を取る:
   - **docs に集約があるが実装ディレクトリにない**(または逆)
   - **docs の不変条件がコードの `superRefine` に反映されていない**(または逆に、コードにあるが docs にない不変条件)
   - **docs の集約内 data とコードのスキーマフィールドの不一致**(フィールドの追加・削除・リネーム)
   - **docs にある値オブジェクト・イベントが `value-objects/` や `events/` に存在しない**(または逆)

### 4. 突合 C: ユビキタス言語 ↔ コード命名

1. `docs/domain/08a`〜`08h` のユビキタス言語ドキュメントから、各 BC の用語(日本語名と対応する英語名)を抽出する
2. 対応する BC の `packages/domain/src/<bc>/` 配下の型名・関数名・スキーマ名と照合する
3. 差分を取る:
   - **UL に定義された用語に対応するコード上の名前がない** — 未実装または命名の乖離
   - **コード上の名前に対応する UL 定義がない** — UL への追記漏れ、または UL に載せる必要がない内部実装名

   命名の乖離は、UL の英語名とコードの型名/関数名の不一致を対象とする。日本語→英語の翻訳のゆれ(例: 「取引」→ `Transaction` vs `Trade`)は、UL 側に英語名が明記されている場合のみ検出する。

### 5. 乖離の評価と Issue 起票

検出した乖離それぞれについて:

1. **重複チェック**: 同じ乖離を報告する既存の open Issue がないか検索する(`gh issue list --state open --search "<乖離のキーワード>"`)。既存 Issue があればスキップする
2. **docs とコードのどちらが正かの推定**: 以下を手がかりにする(確定ではなく推定として Issue に記載する):
   - git log で最終更新が新しい方が正である可能性が高い
   - コードが実際にテストされて動いているなら、コード側が正である可能性が高い
   - 判断できない場合は「どちらが正か不明」と明記する
3. **`ready-to-implement` 判定**: docs とコードのどちらが正かが自明で、修正が機械的に行える場合(例: README への export 名追記)は `ready-to-implement` を付与する。判断が必要な場合は `needs-decision` を付与する。これは「ready 化は人間起点のみ」(`docs/automation/backlog-routine.md` 設計原則「ready 化と実装は分離する」)の明文化された例外であり、自明で機械的な乖離修正に限る(マージ判断のゲートは残るため実害は小さい)
4. **Issue 起票**:

   タイトル: `[docs-drift] <乖離の要約>`

   本文の構成:
   - **何の乖離か**: 1〜2 文で事実を述べる(docs の記述とコードの実態)
   - **docs 側の記述**(該当箇所の引用またはパス + 行番号)
   - **コード側の実態**(該当箇所のパス + 行番号)
   - **修正方針案**: A(docs を直す)と B(コードを直す)の両方を示し、推定があればその根拠を添える
   - **回答後の流れ**: `ready-to-implement` なら「次の定時実行が拾います」、`needs-decision` なら「方針を決めて `ready-to-implement` を付け替えてください」

   ラベル付与(冪等):

   ```bash
   gh label create "docs-drift" --color C2E0C6 --description "ドキュメントとコードの乖離" 2>/dev/null || true
   gh issue create --title "[docs-drift] ..." --body "..." --label "docs-drift,ready-to-implement"
   # または --label "docs-drift,needs-decision"
   ```

### 6. 報告

以下を報告する:

- 各突合(A / B / C)の結果サマリ(検査項目数・乖離検出数)
- 起票した Issue の一覧(番号・タイトル・付与ラベル)
- 乖離が無い場合はその旨(「全突合で乖離なし。起票なし」)
- スキップした乖離(既存 Issue と重複)があればその旨

## 制約

- **読み取り専用** — コード・docs を変更しない。成果物は乖離報告 Issue のみ
- **自動修正しない** — 乖離の修正は必ず Issue 経由で人間の承認を待つ
- **機械的に突合する** — export 名・型名・集約名などの文字列一致で検出する。意味的な解釈に頼った曖昧な指摘はしない
- `status:in-progress` は `/issue-work` の排他ロック。docs-drift は着手ロックを使わない(読み取り専用のため)し、他 Issue のロックにも触れない
