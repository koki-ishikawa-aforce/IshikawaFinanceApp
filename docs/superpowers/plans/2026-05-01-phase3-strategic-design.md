# Phase 3 戦略的設計 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** イシカワ家計アプリの戦略的設計を確定させ、Phase 4（実装計画）に渡せる状態にする。境界づけられたコンテキスト・コンテキストマップ・サブドメイン分類・コンテキストごとのユビキタス言語（kawasima ドメイン記述ミニ言語で記述）・集約候補リストの 5 成果物を完成させる。

**Architecture:** コンテキスト先行ループ（仮説 → 検証 → 補正）でコンテキストを確定させた後、サブドメイン分類・ユビキタス言語記述・集約候補特定・コンテキストマップ作成を順に実施。最後にシナリオ A/B/C コンテキスト視点再走 + DDD サニティチェック（15 項目）で検証する。

**Tech Stack:** Markdown + drawio。コード実装はゼロ。すべてドキュメント成果物。

**Spec:** [docs/superpowers/specs/2026-05-01-phase3-approach-design.md](../specs/2026-05-01-phase3-approach-design.md)

**前提読書（タスク開始前に必ず読む）:**
- `docs/domain/01-overview.md` — ドメインの輪郭・スコープ・技術スタック・プライバシールール
- `docs/domain/02-event-storming.md` — 146 イベントの一次リスト（§1〜§12）
- `docs/domain/03-open-questions.md` — 解決済み論点と残課題
- `docs/domain/04-scenario-a-monthly-cycle.md` — 月次サイクル全景
- `docs/domain/05-scenario-b-onboarding.md` — オンボーディング
- `docs/domain/06-scenario-c-classification-learning.md` — 未分類修正と memorization 学習
- 上記 spec — Phase 3 の方法論・ミニ言語方言・成果物構造の詳細

---

## File Structure

```
docs/domain/
├─ 02-event-storming.md          (modify §16 追記)
├─ 03-open-questions.md          (modify A.4 節追加)
│
├─ 07-bounded-contexts.md        (create)
│   ├─ §1 コンテキスト一覧と責務
│   ├─ §2 サブドメイン分類
│   ├─ §3 §1〜§12 イベントの帰属マッピング
│   └─ §4 コンテキスト間関係の説明
│
├─ 08-ubiquitous-language.md     (create, インデックス)
│   ├─ §1 ミニ言語の文法サマリ
│   ├─ §2 共通語彙
│   └─ §3 各コンテキストへのリンク
│
├─ 08a-ul-<context>.md           (create, コンテキスト数だけ繰り返し)
├─ 08b-ul-<context>.md
├─ ...
│
├─ 09-aggregates.md              (create)
│   ├─ §1 集約候補リスト
│   └─ §2 集約境界の議論
│
├─ 10-strategic-design-validation.md (create)
│   ├─ §1〜§3 シナリオ A/B/C コンテキスト視点再走
│   └─ §4 DDD サニティチェック結果
│
└─ diagrams/
    └─ 07-context-map.drawio     (create)
```

---

## Task 1: コンテキスト仮説の立案

**Files:**
- Create: `docs/domain/07-bounded-contexts.md`

**Goal:** §1〜§12 のイベントストーミングと直感を土台に、5〜8 個のコンテキスト仮説を立てて文書化する。

- [ ] **Step 1.1: 02-event-storming.md §1〜§12 を読む**

`docs/domain/02-event-storming.md` 全文を読み、各セクションのイベント群が「誰の責務か／どの語彙を使っているか」を把握する。特に注目するセクション:
- §1 メール取込系（外部 I/O 中心）
- §5 自動分類系（学習データの所有・per-user）
- §10 明細確定（CSV/PDF 取込・差額管理）
- §11 通知配信系（LINE / メール）
- §12 経費（家計分析対象外）

- [ ] **Step 1.2: 07-bounded-contexts.md を新規作成し、ヘッダと §1 仮説節を書く**

ファイル冒頭は以下のフォーマット:

```markdown
# 境界づけられたコンテキスト（Bounded Contexts）

> 本ドキュメントは Phase 3 戦略的設計の中核成果物である。
> 作成: 2026-05-01

## 1. コンテキスト仮説（暫定）

> Step 2 の仮説検証ループで補正される予定。

| # | コンテキスト名 | 責務（1 文） | 核となる名詞 | 想定される境界（隣接コンテキスト） |
|---|---|---|---|---|
| 1 | （例: 取引取込） | （例: SMBC通知メールから取引候補を生成し下流に渡す） | （例: SMBC通知メール / 取引候補） | （例: 自動分類 / 残高管理） |
| ... |
```

仮説の立て方の指針:
- 「**動詞のセット**が同じ範囲」をひとつのコンテキストにする（例: パースする・抽出する・取り込む は「取込」コンテキスト）
- 「**所有者軸**が違う範囲」は分離候補（例: 学習データは per-user → 学習コンテキストは個人スコープ）
- 「**外部システム接続点**」は ACL の境界候補（Gmail / LINE / SMBC / Anthropic / 別銀行）
- 「**時間軸が違う**範囲」は分離候補（リアルタイム集計 vs バッチ処理 vs 月次精算）

仮説候補の出発点（直感ベース、必要に応じて補正）:
1. **取引取込**: メール／CSV／PDF からの取引データ取り込みと正規化
2. **自動分類・学習**: 加盟店名／Amazon商品キーから分類を当てる、ユーザー修正で学習する
3. **家計分析（取引・カテゴリ・費用区分）**: 取引の費用区分・カテゴリでの集計、月次レポート生成
4. **残高・未払金管理**: SMBC残高・別銀行貯蓄・NISA積立・クレカ未払金の追跡
5. **経費精算**: 経費(会社) フラグの取引と経費種別・上限・按分・月次精算
6. **オンボーディング・認証**: LIFF / LINE Login / Gmail OAuth / 役割判定 / 初期残高
7. **通知配信**: LINE 共通トークルーム / 個人 DM / フェイルセーフメール
8. **マスタ管理**: カテゴリ・経費種別の追加・削除・移動先選択

5〜8 個を目安に、上記から取捨選択・統合する。

- [ ] **Step 1.3: コミット**

```bash
git add docs/domain/07-bounded-contexts.md
git commit -m "docs(domain): Phase 3 Step1 コンテキスト仮説を追加"
```

---

## Task 2: 仮説検証ループ（イベント帰属マッピング）

**Files:**
- Modify: `docs/domain/07-bounded-contexts.md` (§1 確定版 + §3 マッピング追加)

**Goal:** 146 イベントを §単位で各コンテキストに割当て、ハマらないものを発見して仮説を補正する。

- [ ] **Step 2.1: §3 イベント帰属マッピング表を作る**

07-bounded-contexts.md に §3 を追加:

```markdown
## 3. §1〜§12 イベントの帰属マッピング

各セクション・各イベントを Step 1 のコンテキスト仮説に割当てる。
複数コンテキストに跨るものは「跨ぐ」とマークし、§4 で関係種別を議論する。

### §1.1 SMBC通知メール

| イベント | 主担当コンテキスト | 跨ぐ先 |
|---|---|---|
| 日次メール取込バッチが起動された | 取引取込 | - |
| 過去 5 日以前のメールが Gmail API で一括取得された | 取引取込 | - |
| SMBCカード利用通知メールが受信された | 取引取込 | - |
| ... |

### §1.2 Amazon 注文確認メール
...
```

- [ ] **Step 2.2: §1〜§12 を 1 セクションずつ埋める（イテレーション 1 周目）**

事前読書で読んだ 02-event-storming.md を見ながら、各イベントに主担当コンテキストを割当てる。「主担当が決められない」「2 つに半々」と感じたら、その場でメモ（後で議論）。

判定の指針:
- イベント名の動詞が「取り込む」「パースする」「変換する」 → 取引取込
- 「分類された」「学習データに反映された」 → 自動分類・学習
- 「集計された」「レポートに表示された」 → 家計分析
- 「残高が更新された」「未払金が消し込まれた」 → 残高・未払金管理
- 「経費種別」「按分された」「精算入金」 → 経費精算
- 「LINE で配信された」「メール送信された」 → 通知配信
- 「マスタが追加された」「削除時に移動先が選択された」 → マスタ管理
- 「LINE Login」「OAuth」「初期残高」 → オンボーディング・認証

- [ ] **Step 2.3: 仮説の補正（コンテキスト統合・分割・改名）**

1 周目の結果を見て:
- ある仮説コンテキストにイベントが 0〜1 個しか集まらない → 隣接コンテキストに統合
- ある仮説コンテキストにイベントが 30+ 集まる → 分割を検討
- 「跨ぐ」が大量に発生する箇所 → コンテキスト境界の引き方に問題あり、仮説を補正

§1（コンテキスト一覧）を「（暫定）」から「（確定）」に書き換え、補正後の最終リストにする。

- [ ] **Step 2.4: 2 周目の確認**

補正後のコンテキスト一覧で再度 §3 マッピングを確認。すべてのイベントが「主担当 = 1 コンテキスト」に収まる、または「跨ぐ」が論理的に説明できる状態にする。

- [ ] **Step 2.5: コミット**

```bash
git add docs/domain/07-bounded-contexts.md
git commit -m "docs(domain): Phase 3 Step2 仮説検証ループでコンテキストとイベント帰属を確定"
```

---

## Task 3: サブドメイン分類

**Files:**
- Modify: `docs/domain/07-bounded-contexts.md` (§2 追加)

**Goal:** 各コンテキストに Core / Supporting / Generic を割当て、Phase 4 以降の労力配分の指針を作る。

- [ ] **Step 3.1: §2 サブドメイン分類節を追加**

07-bounded-contexts.md に §2 を挿入（§1 と §3 の間）:

```markdown
## 2. サブドメイン分類

| # | コンテキスト名 | 種別 | 根拠 |
|---|---|---|---|
| 1 | （例: 家計分析） | Core | 本アプリの存在意義（ゴール①「支出を目的別に把握」）を直接実現する。差別化要因（プライバシールール3段階、費用区分4値）を担う |
| 2 | （例: 自動分類・学習） | Core | memorization 学習・F-1完全個人別・X-1 Amazon特例 等、本アプリ独自の判断ロジックが集中する |
| 3 | （例: 経費精算） | Supporting | 家計分析を支える業務だが、ロジックは「上限 + 先着按分 + 月次精算」と定型的。差別化なし |
| 4 | （例: 取引取込） | Supporting | パース・正規化は一般的。SMBC固有のフォーマットだが汎用パーサで十分 |
| 5 | （例: 通知配信） | Generic | LINE Messaging API のラッパー。差別化なし |
| 6 | （例: オンボーディング・認証） | Generic | LINE Login + Gmail OAuth + 許可リスト。標準パターン |
| 7 | （例: マスタ管理） | Generic | CRUD + 削除時の移動先選択。標準パターン |
```

判定の指針:
- **Core**: ユーザー価値の中核を担う、独自ロジックが集中する、ここがダメだと製品として成立しない
- **Supporting**: Core を支えるが業界一般的な業務、独自性は低いが必要
- **Generic**: 汎用部品で済む、外部 SaaS 等で代替可能

- [ ] **Step 3.2: コミット**

```bash
git add docs/domain/07-bounded-contexts.md
git commit -m "docs(domain): Phase 3 Step3 サブドメイン分類を追加"
```

---

## Task 4: ユビキタス言語インデックスと共通語彙

**Files:**
- Create: `docs/domain/08-ubiquitous-language.md`

**Goal:** ユビキタス言語のインデックスファイルを作り、ミニ言語の文法サマリと、複数コンテキストで使う共通語彙を定義する。

- [ ] **Step 4.1: 08-ubiquitous-language.md を新規作成**

```markdown
# ユビキタス言語（インデックス）

> 本ドキュメントは Phase 3 戦略的設計のユビキタス言語成果物。
> 記法: kawasima ドメイン記述ミニ言語（[原典](https://scrapbox.io/kawasima/%E3%83%89%E3%83%A1%E3%82%A4%E3%83%B3%E8%A8%98%E8%BF%B0%E3%83%9F%E3%83%8B%E8%A8%80%E8%AA%9E)）+ 本プロジェクト固有方言（spec §2.3）

## 1. ミニ言語の文法サマリ

### 1.1 キーワード

| 記号 | 意味 |
|---|---|
| `data X = ...` | データ構造の定義 |
| `behavior X = 入力 -> 出力` | 振る舞い（処理）の定義 |
| `=` | 定義の左辺と右辺を結ぶ |
| `AND` | すべて必要 |
| `OR` | どれか1つの形を選ぶ |
| `?` | オプショナル |
| `List<X>` | 同種の要素が複数ある |
| `//` | コメント |

### 1.2 プロジェクト固有方言（spec §2.3 より）

- **集約ルート印**: `// aggregate root` コメントを `data` の直前に置く
- **ACL（翻訳層）**: `behavior` で外部スキーマ → 内部 data の変換を明示
- **ドメインイベント**: イベント自体を `data` として定義し、`behavior` の出力に含める
- **不変条件・事前/事後条件**: `behavior` 直後の `//` コメントで書く
- **クロスコンテキスト参照**: 別コンテキストの集約は ID 型のみを `data` で借り、`// referenced from: <他コンテキスト>` コメントを付ける

### 1.3 設計指針（kawasima 指針より）

- **フラグではなく OR で状態を表現**（boolean 禁止、`OR` で場合分け）
- **ステータスコードではなく型と遷移**（`data X = 状態A OR 状態B` + `behavior 遷移 = 状態A -> 状態B`）
- **? の濫用回避**（業務上ありえない状態を許容しないように）
- **失敗パスを OR で明示**（`-> 成功 OR 失敗`）
- **共通抽出 + AND 合成**（ほぼ同じ data はコピペせず共通部を切り出す）

## 2. 共通語彙（複数コンテキストで参照される data）

```
// 識別子
data 取引ID = 文字列  // ULID
data ユーザーID = 文字列  // LINE userID
data 加盟店ID = 文字列
data カテゴリID = 文字列
data 費用区分 = 世帯 OR 個人(夫) OR 個人(妻) OR 経費(会社)
data 経費種別ID = 文字列
data Gmail_message_ID = 文字列  // メール重複検出用

// 値オブジェクト
data 金額 = 整数  // 円単位、負値は返金
data 発生日時 = 日時  // ISO 8601
data 加盟店名 = 文字列  // NFKC 正規化済み
data 所有者 = 夫 OR 妻 OR 共有

// 列挙
data カテゴリ = 住居光熱通信 OR 食費 OR 娯楽 OR その他 OR 未分類 OR ユーザー追加カテゴリ
data 経費種別 = ジム OR 新聞図書費 OR AI利用費 OR 交通費 OR その他経費 OR ユーザー追加経費種別
```

> 各コンテキスト内で固有の使い方をする場合は、コンテキストごとのファイルで上書き定義する（pragmatics 層）。

## 3. コンテキスト別ユビキタス言語

| ファイル | コンテキスト |
|---|---|
| `08a-ul-<context>.md` | （Task 5 で記述） |
| ... |
```

- [ ] **Step 4.2: コミット**

```bash
git add docs/domain/08-ubiquitous-language.md
git commit -m "docs(domain): Phase 3 Step4 ユビキタス言語インデックスと共通語彙を追加"
```

---

## Task 5: コンテキスト別ユビキタス言語の記述

**Files:**
- Create: `docs/domain/08a-ul-<context>.md` 〜 `08*-ul-<context>.md`（Task 2 で確定したコンテキスト数だけ繰り返し）
- Modify: `docs/domain/08-ubiquitous-language.md` (§3 リンク表更新)

**Goal:** Task 2 で確定したコンテキストごとに、ミニ言語で `data` / `behavior` を記述する。**1 コンテキスト = 1 ファイル = 1 コミット** の粒度で進める。

各コンテキストファイルのテンプレート:

```markdown
# ユビキタス言語: <コンテキスト名>

> 親: [docs/domain/08-ubiquitous-language.md](./08-ubiquitous-language.md)
> サブドメイン: Core / Supporting / Generic（07-bounded-contexts.md §2 から転記）

## 責務

<コンテキストの責務を 2〜3 文で>

## 1. データ（data）

\`\`\`
// このコンテキスト固有の data を列挙
// 共通語彙を再定義する場合（pragmatics）はその旨をコメントで明示

// aggregate root
data <集約ルート> = ...
   AND ...

data <値オブジェクト> = ...
\`\`\`

## 2. 振る舞い（behavior）

\`\`\`
// 入出力 behavior を列挙
// ACL の場合は「外部スキーマ → 内部 data」と明示

behavior <処理名> = <入力> -> <出力>
// 事前: ...
// 事後: ...
\`\`\`

## 3. ドメインイベント

\`\`\`
data <Xイベント> = ... AND 発生日時
\`\`\`

## 4. 隣接コンテキストとの境界

| 隣接 | 関係 | 翻訳層 behavior |
|---|---|---|
| <隣接コンテキスト> | ACL / 顧客-供給者 / 共有カーネル / 等 | <behavior 名> |
```

- [ ] **Step 5.1: コンテキスト 1 つ目（推測: 取引取込 or 家計分析）**

Task 2 で確定したコンテキストの 1 つ目を選び、上記テンプレートに沿って `08a-ul-<context>.md` を作成。

記述順の推奨:
1. 責務を書く
2. 集約ルート候補を 1 つ選び、`// aggregate root` を付けて `data` を書く
3. その集約に必要な値オブジェクト（加盟店名・金額 等、共通語彙にないもの）を `data` で書く
4. 集約のライフサイクルを `behavior` で書く（生成・更新・状態遷移）
5. 失敗パスを忘れずに `OR <エラー>` で明示
6. ドメインイベントを書く
7. 隣接コンテキストとの境界表を埋める

完了基準:
- フラグ・ステータスコードを使っていない（OR + behavior で表現）
- 失敗が想定される behavior には OR で失敗パスがある
- ? の使用が業務上の任意性に対応している
- 集約ルートが 1〜3 個明示されている

- [ ] **Step 5.2: 1 コンテキスト目をコミット**

```bash
git add docs/domain/08a-ul-<context>.md
git commit -m "docs(domain): Phase 3 Step4 <コンテキスト名>のユビキタス言語を追加"
```

- [ ] **Step 5.3: 残りのコンテキスト分、Step 5.1〜5.2 を繰り返す**

各コンテキストごとに `08b-ul-...`, `08c-ul-...` と作成し、それぞれ別コミット。

各 file 完了時に 08-ubiquitous-language.md §3 のリンク表を更新する（または最後にまとめて更新）。

- [ ] **Step 5.4: 全コンテキスト完了後、08-ubiquitous-language.md §3 を最終更新**

リンク表に全 `08*-ul-*.md` ファイルを追加。

```bash
git add docs/domain/08-ubiquitous-language.md
git commit -m "docs(domain): Phase 3 Step4 ユビキタス言語インデックスのリンク表を更新"
```

---

## Task 6: 集約候補の特定

**Files:**
- Create: `docs/domain/09-aggregates.md`

**Goal:** Task 5 で書いた各コンテキストの `// aggregate root` 印を集めて一覧化し、集約境界の妥当性を点検する。

- [ ] **Step 6.1: 09-aggregates.md を新規作成**

```markdown
# 集約候補リスト

> 本ドキュメントは Phase 3 戦略的設計の集約候補成果物。
> Task 5 で各コンテキストファイル（08*-ul-*.md）に `// aggregate root` を付けた data を集めて整理。

## 1. 集約候補リスト

| コンテキスト | 集約ルート | 不変条件（同一トランザクションで守るべき） | 集約内に含める data | 外部参照（ID のみ） |
|---|---|---|---|---|
| 取引取込 | 取引候補 | パース失敗時は取引候補が生成されない | 加盟店名候補、金額候補、発生日時候補 | Gmail_message_ID |
| 家計分析 | 取引 | 費用区分が4値のいずれか / 経費(会社) ならば経費種別必須 | カテゴリ、費用区分、加盟店名、金額、発生日時 | カテゴリID、費用区分、所有者 |
| 残高・未払金管理 | 残高（口座別） | 残高 = 初期残高 + Σ取引金額 | 取引履歴の参照（ID列）、最終更新日時 | 取引ID |
| 経費精算 | 月次経費サイクル | 経費種別累計 ≤ 上限（超過分は子取引に分割） | 当月の経費取引リスト、月次累計、上限値、経費精算入金 | 取引ID、経費種別ID |
| ... |

## 2. 集約境界の議論

### 2.1 集約サイズの妥当性

- 集約が大きすぎないか（1 トランザクションで触る範囲が広すぎないか）
- 集約が小さすぎないか（不変条件を守るのに別の集約も同時にロックする必要が出ないか）

### 2.2 集約間参照は ID か

- すべての集約間参照が ID 経由になっているか確認
- 直参照になっている箇所があれば修正

### 2.3 不変条件の閉包性

- 各集約の不変条件が、その集約内のデータだけで判定できるか
- 「他の集約の状態に依存する不変条件」がある場合、その整合性は結果整合性（イベント駆動）で守る形にする
```

- [ ] **Step 6.2: 各 08*-ul-*.md ファイルから `// aggregate root` を grep して、表に転記**

```bash
grep -B1 "// aggregate root" docs/domain/08*-ul-*.md
```

の出力を見て、すべての集約ルートを §1 の表に転記する。

- [ ] **Step 6.3: 集約境界の議論（§2）を埋める**

各集約について 2.1〜2.3 を確認し、問題があれば該当コンテキストの 08*-ul-*.md を修正、なければ「OK」と書く。

- [ ] **Step 6.4: コミット**

```bash
git add docs/domain/09-aggregates.md docs/domain/08*-ul-*.md
git commit -m "docs(domain): Phase 3 Step5 集約候補リストを追加"
```

---

## Task 7: コンテキストマップ作成

**Files:**
- Create: `docs/domain/diagrams/07-context-map.drawio`
- Modify: `docs/domain/07-bounded-contexts.md` (§4 追加)

**Goal:** drawio でコンテキスト間の関係と外部システム接続を図示し、関係種別を文章で説明する。

- [ ] **Step 7.1: drawio を開いて 07-context-map.drawio を新規作成**

drawio のレイアウト指針:
- **中央に Core コンテキスト**（家計分析・自動分類等）を配置
- **周囲に Supporting コンテキスト**を配置
- **外周に Generic コンテキスト**と **外部システム**を配置
- **矢印で関係**を示し、関係種別ラベル（"Customer-Supplier", "ACL", "Shared Kernel", "Conformist", "Open Host Service" 等）を付ける

外部システムとして必ず含めるもの:
- Gmail（OAuth + Messages API）
- LINE Messaging API（共通トークルーム + 個人 DM）
- LINE Login（LIFF）
- SMBC（メール通知の発信元、明細 CSV/PDF 取得元）
- Anthropic API（PDF→CSV 変換）
- 別銀行貯蓄口座（手入力による補完）
- SBI 証券 / 楽天証券（NISA 積立振込先）
- AWS Parameter Store（シークレット）

関係種別の選び方の指針:
- **ACL（Anti-Corruption Layer）**: 外部システムとの接続、または 別言語のコンテキストとの接続
- **Customer-Supplier**: 一方が要求し、もう一方が提供する関係（取引取込 → 家計分析 等）
- **Shared Kernel**: 複数コンテキストで共通の data 定義を共有（共通語彙のみ）
- **Conformist**: 上流の言語にそのまま従う（外部 SaaS API 等）
- **Open Host Service**: 多くのコンテキストから使われる公開サービス（通知配信 等）
- **Separate Ways**: 関係なし

- [ ] **Step 7.2: 07-bounded-contexts.md §4 を追加**

```markdown
## 4. コンテキスト間関係

### 4.1 関係マトリクス

| From → To | 関係種別 | 説明 |
|---|---|---|
| 取引取込 → 自動分類 | Customer-Supplier | 取引取込が取引候補を供給、自動分類が分類して下流へ |
| 自動分類 → 家計分析 | Customer-Supplier | 分類済み取引を供給 |
| 取引取込 ← Gmail | ACL | Gmail メッセージを SMBC通知メール内部表現に翻訳 |
| 取引取込 ← Anthropic API | ACL | PDF を CSV に変換（外部 LLM の出力を内部 CSV 形式に正規化） |
| 通知配信 → LINE Messaging API | Conformist | LINE の Flex Message 仕様に従う |
| ... |

### 4.2 外部システム接続点（ACL の必要性）

| 外部システム | 接続コンテキスト | ACL の責務 |
|---|---|---|
| Gmail | 取引取込 | OAuth トークン管理 + メッセージ取得 + 重複除外（Gmail message ID） |
| LINE Messaging API | 通知配信 | Channel Access Token 管理 + push API 呼び出し + 配信ログ記録 |
| LINE Login | オンボーディング・認証 | LIFF 初期化 + LINE userID → 内部ユーザーID 変換 + 許可リスト照合 |
| SMBC（メール）| 取引取込 | メール本文パース + 通知形式の差異吸収 |
| Anthropic API | 取引取込 | PDF → CSV プロンプト + レスポンスパース + 失敗ハンドリング |
| 別銀行貯蓄口座 | 残高・未払金管理 | （API なし、手入力 + 振込通知での自動加算のみ） |
| SBI / 楽天証券 | 残高・未払金管理 | （API なし、SMBC 振込通知での積立累計加算のみ） |

### 4.3 図の参照

詳細は [diagrams/07-context-map.drawio](./diagrams/07-context-map.drawio) を参照。
```

- [ ] **Step 7.3: コミット**

```bash
git add docs/domain/diagrams/07-context-map.drawio docs/domain/07-bounded-contexts.md
git commit -m "docs(domain): Phase 3 Step6 コンテキストマップと関係マトリクスを追加"
```

---

## Task 8: シナリオ A コンテキスト視点再走

**Files:**
- Create: `docs/domain/10-strategic-design-validation.md`

**Goal:** シナリオ A（月次サイクル全景）の主要ステップを kawasima ワークフロー記述で書き直し、コンテキスト境界の妥当性を検証する。

- [ ] **Step 8.1: 04-scenario-a-monthly-cycle.md を読む**

シナリオ A の各ステップを把握する。

- [ ] **Step 8.2: 10-strategic-design-validation.md を新規作成、§1 を埋める**

```markdown
# 戦略的設計の検証

> 本ドキュメントは Phase 3 戦略的設計の検証成果物。
> 検証方法: シナリオ A/B/C コンテキスト視点再走 + DDD サニティチェック 15 項目（spec §2.1, §3 Step 7）

## 1. シナリオ A コンテキスト視点再走（月次サイクル）

### 1.1 取引発生フェーズ（リアルタイム）

\`\`\`
Bounded Context: 取引取込
ワークフロー: "SMBC利用通知メールから取引候補を抽出する"
  トリガー: "SMBCカード利用通知メールが受信された"
  主要インプット: SMBC通知メール本文
  他のインプット: -
  出力イベント: "取引候補が抽出された"
  副作用: -

Bounded Context: 自動分類
ワークフロー: "取引候補を自動分類する"
  トリガー: "取引候補が抽出された"
  主要インプット: 取引候補
  他のインプット: 加盟店分類学習データ（per-user）
  出力イベント: "取引が自動分類で取り込まれた" OR "取引が未分類で取り込まれた"
  副作用: 残高/未払金が更新される（→ 残高・未払金管理）

Bounded Context: 残高・未払金管理
ワークフロー: "取引で残高・未払金を更新する"
  トリガー: "取引が（自動分類 or 未分類で）取り込まれた"
  主要インプット: 取引
  他のインプット: 該当口座の現在残高
  出力イベント: "口座残高が更新された" / "クレカ未払金が更新された"
  副作用: -
\`\`\`

### 1.2 月次レポート CSV 確定フェーズ

ユーザーが CSV/PDF をアップロードしてから、月次レポートが「CSV確定」状態に昇格して LINE 配信されるまでのフロー:

\`\`\`
Bounded Context: 取引取込
ワークフロー: "CSV/PDF をアップロードする"
  ...

Bounded Context: 家計分析
ワークフロー: "月次レポートをCSV確定状態に昇格する"
  ...

Bounded Context: 通知配信
ワークフロー: "月次レポートサマリを LINE 配信する"
  ...
\`\`\`

### 1.3 経費精算最終確定フェーズ

経費精算入金後の差額按分から最終確定状態昇格までのフロー（配信なし、値のみ更新）:

\`\`\`
（同様に Bounded Context ごとにワークフローを書く）
\`\`\`

### 1.4 シナリオAで発見されたコンテキスト境界の問題

| 問題 | 該当箇所 | 対応 |
|---|---|---|
| （なし、または「Xというイベントが2つのコンテキストに跨る」等） | ... | （07-bounded-contexts.md を修正、または Phase 4 で実装パターンとして対処） |
```

- [ ] **Step 8.3: コミット**

```bash
git add docs/domain/10-strategic-design-validation.md
git commit -m "docs(domain): Phase 3 Step7-1 シナリオAコンテキスト視点再走を追加"
```

---

## Task 9: シナリオ B コンテキスト視点再走

**Files:**
- Modify: `docs/domain/10-strategic-design-validation.md` (§2 追加)

**Goal:** シナリオ B（オンボーディング）を同様にワークフロー記述で書き直す。

- [ ] **Step 9.1: 05-scenario-b-onboarding.md を読む**

- [ ] **Step 9.2: §2 シナリオ B 再走を追加**

オンボーディングは Phase 0〜4 の段階があるので、各 Phase ごとにワークフローを書く:

```
## 2. シナリオ B コンテキスト視点再走（オンボーディング）

### 2.1 Phase 0: デプロイ前提条件
（システム管理者のセットアップ。コンテキストとしては マスタ管理 / オンボーディング・認証 が中心）

### 2.2 Phase 1: 役割判定と初回ログイン
（Bounded Context: オンボーディング・認証 中心）

### 2.3 Phase 2: 初期設定（A: Gmail OAuth / B: 初期残高 / C-E: マスタ確認 / F: 初期CSV取込）

### 2.4 Phase 3: 配偶者完了待ち
### 2.5 Phase 4: LINE 連携と運用開始
```

各サブセクションで Bounded Context ごとにワークフローを書く。

- [ ] **Step 9.3: §2.6 シナリオBで発見された問題**

| 問題 | 該当箇所 | 対応 |
|---|---|---|

- [ ] **Step 9.4: コミット**

```bash
git add docs/domain/10-strategic-design-validation.md
git commit -m "docs(domain): Phase 3 Step7-2 シナリオBコンテキスト視点再走を追加"
```

---

## Task 10: シナリオ C コンテキスト視点再走

**Files:**
- Modify: `docs/domain/10-strategic-design-validation.md` (§3 追加)

**Goal:** シナリオ C（未分類修正と memorization 学習）を同様に書き直す。

- [ ] **Step 10.1: 06-scenario-c-classification-learning.md を読む**

- [ ] **Step 10.2: §3 シナリオ C 再走を追加**

```
## 3. シナリオ C コンテキスト視点再走（未分類修正と学習）

### 3.1 未分類取引の発見と修正
（Bounded Context: 家計分析 → 自動分類 が中心）

### 3.2 memorization 学習の反映
（Bounded Context: 自動分類 中心）

### 3.3 過去未分類取引への遡及（J-3）
（Bounded Context: 自動分類 + 家計分析）

### 3.4 既存ルール上書き（L-4）
### 3.5 学習無効化（M-1）
### 3.6 CSV 取込時の一括分類（N-1）
### 3.7 Amazon 商品キー学習（X-1）
```

- [ ] **Step 10.3: §3.8 シナリオCで発見された問題**

- [ ] **Step 10.4: コミット**

```bash
git add docs/domain/10-strategic-design-validation.md
git commit -m "docs(domain): Phase 3 Step7-3 シナリオCコンテキスト視点再走を追加"
```

---

## Task 11: DDD サニティチェック

**Files:**
- Modify: `docs/domain/10-strategic-design-validation.md` (§4 追加)

**Goal:** spec §3 Step 7-2 の 15 項目チェックを実施し、結果を記録する。要修正点があれば該当ドキュメントを修正してから完了する。

- [ ] **Step 11.1: §4 サニティチェックを追加**

```markdown
## 4. DDD サニティチェック（15 項目）

### 戦略面
| # | 項目 | 結果 | 備考 |
|---|---|---|---|
| 1 | 各コンテキスト内でユビキタス言語が 1 つに揃っているか | OK / 要修正 / N/A | ... |
| 2 | コンテキスト境界をイベントが跨ぐ箇所に明示的な翻訳層（ACL）があるか | ... | ... |
| 3 | Core サブドメインに労力配分が向いているか | ... | ... |
| 4 | コンテキスト数が適正か | ... | ... |

### ミニ言語面
| 5 | フラグ（boolean）で状態を表現していないか | ... | ... |
| 6 | ステータスコードで状態を表現していないか | ... | ... |
| 7 | ?（Optional）が濫用されていないか | ... | ... |
| 8 | behavior が存在するか（anemic でないか） | ... | ... |
| 9 | ほぼ同じ data がコピペで増えていないか | ... | ... |
| 10 | behavior の失敗パスが OR で明示されているか | ... | ... |

### 集約面
| 11 | 集約ルートが各コンテキストで明確に決まっているか | ... | ... |
| 12 | 集約境界を跨ぐ参照が ID 経由になっているか | ... | ... |
| 13 | 1 トランザクションで守るべき不変条件が集約境界内に収まっているか | ... | ... |

### 運用面
| 14 | シナリオ A/B/C で「主役コンテキストが切り替わるポイント」がすべて明示されているか | ... | ... |
| 15 | 03-open-questions.md の論点で Phase 3 解決分・残課題が整理されているか | ... | ... |

## 5. 要修正点の対応

| # | 修正対象ファイル | 修正内容 | 対応コミット |
|---|---|---|---|
| ... |
```

- [ ] **Step 11.2: 各項目を実際にチェック**

該当する 08*-ul-*.md / 09-aggregates.md / 07-bounded-contexts.md / 10-strategic-design-validation.md §1〜§3 を見ながら、項目ごとに「OK / 要修正 / N/A」を判定。

要修正があれば該当ファイルを修正してから当該行を「OK」に書き換える。

- [ ] **Step 11.3: コミット**

```bash
git add docs/domain/
git commit -m "docs(domain): Phase 3 Step7-4 DDDサニティチェック実施と要修正点対応"
```

---

## Task 12: 既存ドキュメント更新

**Files:**
- Modify: `docs/domain/03-open-questions.md` (A.4 節追加)
- Modify: `docs/domain/02-event-storming.md` (§16 マッピング追加、任意)

**Goal:** Phase 3 で解決した論点を 03 に追記、§単位 → コンテキストのマッピングを 02 に追記。

- [ ] **Step 12.1: 03-open-questions.md に A.4 節を追加**

`## A. 解決済み（改訂で確定）` セクションの末尾（A.3 の後）に A.4 を挿入:

```markdown
### A.4 Phase 3（戦略的設計）で解決した論点

| ID | 論点 | 決定 |
|---|---|---|
| 論点45 | コンテキスト分割（並行して Phase 3 へ進む の項目） | （Task 1〜2 で確定したコンテキスト一覧）。詳細は [07-bounded-contexts.md](./07-bounded-contexts.md) |
| 論点46 | サブドメイン分類（Core/Supporting/Generic） | Core: ..., Supporting: ..., Generic: ... 。詳細は [07-bounded-contexts.md §2](./07-bounded-contexts.md) |
| 論点47 | ユビキタス言語の記述形式 | kawasima ドメイン記述ミニ言語を採用。プロジェクト固有方言は spec §2.3 に記載。詳細は [08-ubiquitous-language.md](./08-ubiquitous-language.md) |
| 論点48 | 集約ルート候補 | 各コンテキストにつき 1〜3 個の集約ルートを特定。詳細は [09-aggregates.md](./09-aggregates.md) |
| 論点49 | コンテキストマップ・関係種別 | 詳細は [diagrams/07-context-map.drawio](./diagrams/07-context-map.drawio) と [07-bounded-contexts.md §4](./07-bounded-contexts.md) |
```

§D「次の進め方」を更新:

```markdown
## D. 次の進め方

- ~~並行して Phase 3 へ進む: コンテキストマップ・集約候補・コマンド抽出~~ → **Phase 3 完了済み**（2026-05-01）
- 次フェーズ: Phase 4（実装計画）。実調査タスク（OQ-1, OQ-9, OQ-21, OQ-29）と並行して進められる
```

- [ ] **Step 12.2: 02-event-storming.md §16 を追加（任意）**

§14 の前または §15 の後に §16 を挿入:

```markdown
## 16. §単位 → コンテキスト帰属マッピング

| イベントセクション | 主担当コンテキスト | 跨ぐ先 |
|---|---|---|
| §1.1 SMBC 通知メール | 取引取込 | - |
| §1.2 Amazon 注文確認メール | 取引取込 | 自動分類（Amazon 突合） |
| §2 取引（決済・収入） | 家計分析 | 残高・未払金管理 |
| §3 資金移動 | 残高・未払金管理 | - |
| §4 クレカ未払金 | 残高・未払金管理 | - |
| §5 自動分類 | 自動分類 | - |
| §6 シャドウ口座メンテナンス | 残高・未払金管理 | - |
| §7.1 デプロイ前提条件 | マスタ管理 | オンボーディング・認証 |
| §7.2 オンボーディング | オンボーディング・認証 | マスタ管理、取引取込 |
| §7.3 運用中ライフサイクル | オンボーディング・認証 | - |
| §8 訂正・例外 | 家計分析 | 自動分類（学習更新） |
| §9 レポート生成 | 家計分析 | 通知配信 |
| §10 明細確定（CSV/PDF）| 取引取込 | 家計分析（差額検出） |
| §11 通知配信 | 通知配信 | - |
| §12 経費（家計分析対象外）| 経費精算 | 家計分析（最終確定時の振替） |

> 詳細マッピング（イベント単位）は [07-bounded-contexts.md §3](./07-bounded-contexts.md) を参照。
```

（注: 上記は仮表。Task 2 の確定結果に合わせて書き換える）

- [ ] **Step 12.3: コミット**

```bash
git add docs/domain/03-open-questions.md docs/domain/02-event-storming.md
git commit -m "docs(domain): Phase 3 Step8 既存ドキュメント（03/02）にPhase3結果を反映"
```

---

## Task 13: Phase 3 完了確認

**Goal:** spec §7 Definition of Done の 7 項目をすべて満たすことを確認する。

- [ ] **Step 13.1: ファイル存在確認**

```bash
ls -la docs/domain/07-bounded-contexts.md \
       docs/domain/08-ubiquitous-language.md \
       docs/domain/08*-ul-*.md \
       docs/domain/09-aggregates.md \
       docs/domain/10-strategic-design-validation.md \
       docs/domain/diagrams/07-context-map.drawio
```

すべて存在することを確認。

- [ ] **Step 13.2: DoD 7 項目を spec と照合**

spec §7 の 7 項目（07/08/09/diagrams/10/03 A.4/コミット済み）を確認。

- [ ] **Step 13.3: 完了宣言コミット（任意）**

特に追加変更がなければスキップ。あれば最終コミット。

- [ ] **Step 13.4: ユーザーに Phase 3 完了報告**

報告内容:
- 確定したコンテキスト数と一覧
- サブドメイン分類のサマリ（Core が何個、Supporting が何個、Generic が何個）
- 集約候補の総数
- サニティチェック 15 項目で「要修正」が出た数（できれば 0）
- 残課題（あれば）

---

## Self-Review

### Spec coverage
- ① コンテキスト特定 → Task 1, 2 ✓
- ② コンテキストマップ → Task 7 ✓
- ③ サブドメイン分類 → Task 3 ✓
- ④ ユビキタス言語 → Task 4, 5 ✓
- ⑤ 集約候補 → Task 6 ✓
- 検証（シナリオ再走 + サニティチェック）→ Task 8, 9, 10, 11 ✓
- 既存ドキュメント更新 → Task 12 ✓
- 完了確認 → Task 13 ✓

### Placeholder scan
- 「（例: 取引取込）」のような表中の例示は、Task 2 で確定するまで仮。spec と整合（コンテキスト名は Phase 3 で発見するため、計画段階では具体名を確定できない）
- `<context>` プレースホルダは Task 2 結果に応じて命名

### Type / 命名 consistency
- ファイル名規約: `08a-ul-<context>.md` の `<context>` は kebab-case で統一
- 集約ルート印: `// aggregate root`（一意）
- ACL 表記: 「翻訳層」「ACL（Anti-Corruption Layer）」を併記して両方使う（コンテキスト依存）

問題なし。
