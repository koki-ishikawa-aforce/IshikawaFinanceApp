# わりまる デザインガイド

UI の見た目に関わる変更はこのドキュメントに従う。Living ドキュメントとしてコードの進化に追従させる。

> **本書は「見た目の規約」を定める。「使いやすさ」は [`docs/design/usability.md`](./docs/design/usability.md) が定める。**
>
> | ドキュメント                                             | 扱う問い                                                                     |
> | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
> | 本書(`DESIGN.md`)                                        | 正しい色 / 書体 / 余白か。両テーマで成立するか。アイコン・装飾の規約に沿うか |
> | [`docs/design/usability.md`](./docs/design/usability.md) | 迷わないか。間違えないか。手数が少ないか。支援技術で使えるか                 |
>
> トークンが正しくても使用性の規範には違反しうる(例: 正しいトークンで描かれた空状態が、次に何をすべきか示していない)。UI の変更は両方を満たす必要がある。

> **値の唯一の真実は `packages/web/src/app/globals.css`**。色コード・px 値はここに定義されたトークンが正であり、本ドキュメントには複製しない。スケールの考え方・ルール・意図のみを記す。
>
> スナップショット（変更しない）: `docs/superpowers/specs/2026-05-01-phase3.5-ux-ui-design.md`。`docs/domain/wireframes/design-tokens.md` も Phase 3.5 以前のスナップショットであり、現行ルールは本文書が優先する。

## 1. デザイン原則

- **キュート × ペア感**: パステル配色・角丸・丸ゴシック。夫婦のテーマカラーが対になり、2 人で使うアプリであることが見た目から伝わる
- **LIFF スマホ縦画面前提**: 横画面・タブレット・PC 向けのレイアウト最適化はしない。表示はできるが、縦画面が唯一のターゲット
- **「上限を意識させない」**: 経費精算管理では進捗バーを出さず、合計のみ表示する。ユーザーが気軽に経費フラグを付けられることを優先する

## 2. テーマシステム

2 つのロール（Darling / Honey）にそれぞれ専用のテーマカラーが対応する。

- `:root` が Darling テーマ（デフォルト）
- `[data-theme='honey']` が Honey テーマ

テーマ切替は `data-theme` 属性でルート要素に設定し、CSS 変数が自動的に切り替わる。テーマごとに背景グラデーション・KPI カード色・アクセント色・テキスト色・カテゴリ色が変わる。

**色適用ルール**:

- 自分の画面 = 自分のテーマ
- 自分の画面に出るパートナー（ドメイン用語では「配偶者」）要素（個人費合計など）は、自分のテーマの淡色 + パートナー識別アイコン

値の定義は `globals.css` の `:root` / `[data-theme='honey']` を参照。

## 3. デザイントークン

`globals.css` の `:root` に定義されたトークンを `var(--*)` で参照する。`*.module.css` への直値書き込みは stylelint（`stylelint-declaration-strict-value`）で機械的に禁止される。

### スケールの考え方

- **間隔（`--space-*`）**: 4px 基準。`--space-1` = 4px を基本単位とし、0.5 刻みの中間値を含む等差スケール。上限は `--space-14`（56px）
- **角丸（`--radius-*`）**: 用途別の 5 段階。`--radius-card`（カード）と `--radius-panel`（パネル全体）が主要な 2 値
- **フォントサイズ（`--text-*`）**: KPI ラベルの極小（`--text-xs`）から hero 値の最大（`--text-3xl`）まで 8 段階
- **行間（`--leading-*`）**: 単位なしの倍率で 2 段階。まとまった文章（補足文・注意書き・結果の説明）は `--leading-relaxed`（1.6）、一覧や手順のように短い行を並べる箇所は `--leading-normal`（1.5）。1 行に収まる見出し・ラベルには指定しない
- **アイコンサイズ（`--icon-*`）**: 小 / 中 / 大の 3 段階。px ではなく隣接するテキストに対する相対値（`em`）で定義し、文字サイズを変えたときにアイコンだけ取り残されないようにする（§4 大きさ）
- **書体（`--font-family`）**: 丸ゴシック（Zen Maru Gothic）。`html, body` に加えてフォーム要素（`button` / `input` / `select` / `textarea`）にも `globals.css` で継承させているため、**コンポーネント側で `font-family` を再指定しない**（UA スタイルシートの打ち消しはグローバル 1 か所に集約する）
- **色**: テーマ色（`--accent` / `--bg-gradient` / `--kpi-*` 等）、ロール識別色（`--role-darling` / `--role-honey`、テーマ非依存）、カテゴリ色（`--cat-*`）、意味対応色（`--success` / `--warning` / `--error` 等）、構造色（区切り線の `--divider`、テーマ非依存）
- **影（`--shadow-*`）**: 用途別の合成トークン（`--shadow-sm` 〜 `--shadow-modal`）。テーマ依存の `--shadow-color` / `--shadow-strong` を遅延解決する

### 使用ルール

- 既存スケールに合わない中間値が必要な場合は、最も近いトークンへ寄せる（見た目の微調整よりもスケールの規律を優先）
- トークンに乗らない正当な例外（`transform` の座標・`z-index` 等）はルール対象外
- 新しいトークンの追加は `globals.css` で行い、スケールの一貫性を確認してからコミットする

## 4. アイコン

### react-icons（共通モジュール経由）

アイコンは `react-icons` の Lucide 系（`lu` プレフィックス）を使用し、`packages/web/src/components/ui/icons.ts` の barrel export を経由する。直接 `react-icons` から import しない。

### 大きさ

アイコンの大きさは 3 段階のスケール（`--icon-sm` / `--icon-md` / `--icon-lg`）から選ぶ。指定は共通クラス（`packages/web/src/components/ui/common.module.css` の `.iconSm` / `.iconMd` / `.iconLg`）で行い、`react-icons` の `size` プロパティや `*.module.css` の `width` / `height` に直値を書かない。

| トークン    | 使いどころ                                                               |
| ----------- | ------------------------------------------------------------------------ |
| `--icon-sm` | 文字と並ぶアイコン（文中・ボタンのラベル併記・一覧の行頭・閉じるボタン） |
| `--icon-md` | 併記するラベルより少し目立たせたい主操作のアイコン                       |
| `--icon-lg` | アイコン単体で意味を担うもの（月送り・手順の見出し・下部ナビ）           |

文章の途中に置くアイコンは `.iconInline`（`.iconSm` + 行内での縦位置揃え）を使う。

`--icon-md` の現在の使用は精算画面の主操作 1 か所のみで、同種のボタンでも設定画面は `--icon-sm` を使っている。この不一致を揃えるかは #502 で判断待ちのため、迷う場合は既存の近い画面に合わせる。

**実際の大きさは「基準の `font-size` × トークンの係数」で決まる**。上の表は係数の選び方の目安であり、クラス名の大小がそのまま画面上の大小になるわけではない（例: 取引追加ボタンのアイコンは基準が `--text-xl` のため `.iconSm` でも 20px、下部ナビは基準が `--text-sm` のため `.iconLg` で 18px）。既存の画面でクラスを付け替えるときは、基準の `font-size` を確認してから選ぶ。

単独で置くアイコン（隣に大きさの連動する文字が無いもの）は、相対値の基準となる `font-size` を**アイコン自身、またはアイコンだけを内包する親要素**に明示する（アイコン自身の例: `AppNav.module.css` の `.icon`・`app/balances/page.module.css` の `.balanceIcon`。親要素の例: `app/transactions/page.module.css` の `.fab`・`MonthNavigator.module.css` の `.button`）。基準を書かずに周囲の文字サイズへ委ねると、無関係な文字サイズの変更でアイコンの大きさが動く。

スケールの逸脱は `packages/web/src/test/icon-size-scale.test.ts` が機械的に検出する（width / height はレイアウト用途と区別できず stylelint で縛れないため、アイコンに限ってテストで縛っている）。

同じ理由で、金額カードの文字色（`--text-on-kpi`）と背景（`--kpi-*`）のコントラストは `packages/web/src/test/kpi-contrast.test.ts` が両テーマぶん機械的に検出する。トークンの色を動かしただけで 4.5:1 を割ったかどうかは、見た目の差分では判定できないため。

### UI への絵文字使用は禁止

JSX に絵文字（Unicode Emoji）を表示目的で埋め込まない。装飾も情報伝達もすべて react-icons のラインアイコンまたは CSS で表現する。

### ロール識別アイコン

パートナーの識別は色 + 形状の両方で区別する（色だけに頼らない）。

| ロール  | モチーフ | アイコン     | 色変数           |
| ------- | -------- | ------------ | ---------------- |
| Darling | 花系     | `LuFlower2`  | `--role-darling` |
| Honey   | 船系     | `LuSailboat` | `--role-honey`   |

`RoleIcon` コンポーネント（`packages/web/src/components/ui/RoleIcon.tsx`）がロール→アイコン＋色のマッピングを一元管理する。ニックネームとの併記ルールはスナップショット §3.3 を参照。

## 5. 装飾

### CSS 図形装飾

- 背景にテーマ色（`--accent`）のやわらかなグラデーション円を低 opacity（`--deco-opacity`）で散らす。CSS `radial-gradient` + `opacity` で実装する
- 「Darling は顕著 / Honey は控えめ」の濃淡ルールを `--deco-opacity` の値差（Darling 0.2 / Honey 0.1）で維持する
- 重要 KPI（資産合計）に hero 装飾（CSS グラデーション光沢: コーナーに `radial-gradient` で白のハイライト）

### 絵文字装飾の禁止

背景の散らし装飾・ヒーローカードの装飾に絵文字を使わない。テーマの温かみは CSS のグラデーション図形で表現する（`§4 アイコン` の絵文字禁止と同じ原則）。

## 6. アクセシビリティ

- **`aria-label`**: 意味を持つアイコン（ナビゲーション・操作ボタン等）には必ず `aria-label` を付与する
- **`aria-hidden="true"`**: 装飾目的のアイコン（ロール識別アイコンがニックネームと併記される場合など、テキストで意味が伝わるもの）には `aria-hidden="true"` を付与する
- **色だけに頼らない識別**: ロール識別は色 + 形状（花 / 船）の両方で区別する。状態バッジ（暫定・確定等）もテキストラベルを併記する

## 7. してはいけないこと

- `*.module.css` にデザイントークンの直値（色コード・px 値・角丸・フォントサイズ）を書かない — `var(--*)` を使う
- JSX に絵文字を表示目的で埋め込まない — react-icons のラインアイコンまたは CSS で表現する
- 片方のテーマだけで見た目を確認して完了にしない — darling / honey 両テーマで破綻しないことを確認する
- `react-icons` を `icons.ts` の barrel を経由せず直接 import しない
- アイコンの大きさを画面ごとに決めない — `size` プロパティや `width` / `height` の直値ではなく、共通クラス（`.iconSm` / `.iconMd` / `.iconLg`）から選ぶ
- 色だけでロールや状態を区別しない — 形状・テキストを併用する
- 2〜3 択の切り替えを画面ごとに書き起こさない — 共通部品 `SegmentedControl`（`packages/web/src/components/ui/SegmentedControl.tsx`）を使う（見た目は「選択中を白い面 + アクセントの枠で浮かせる」に統一する）
- 空状態（「〜がありません」）を画面ごとに書き起こさない — 共通部品 `EmptyState`（`packages/web/src/components/ui/EmptyState.tsx`）を使い、`*.module.css` に独自の空状態スタイルを定義しない
- プライバシーで伏せている表示（「配偶者の個人取引のため〜」）を空状態として出さない — 共通部品 `RestrictedState`（`packages/web/src/components/ui/RestrictedState.tsx`）を使い、`*.module.css` に独自のスタイルを定義しない（空状態と同じ見た目だと「データが無い」と受け取られる）
- ローディング（「読み込み中...」）・エラー（「〜の取得に失敗しました」）を画面ごとに書き起こさない — 共通部品 `LoadingState`（`packages/web/src/components/ui/LoadingState.tsx`）・`ErrorState`（同 `ErrorState.tsx`）を使い、`*.module.css` に独自の `.loading` / `.error` を定義しない
- 取得失敗からの再読み込みを画面ごとに書き起こさない — `ErrorState` の `onRetry` に渡す（文言と置き場所が揃い、ボタンが読み上げ範囲の外に置かれる）
- 補足文（`.note` / 一段大きい `.noteLg`）・注意書き（`.warning`）・一覧の行に並べるリンク風のボタン（`.textButton` / `.textButtonDanger`）を画面ごとに定義しない — `common.module.css` の共通クラスを使う
- 行間を画面ごとに数値で書かない — `--leading-normal` / `--leading-relaxed` から選ぶ（stylelint が直値を止める）
- 金額カード（`--kpi-*` を背景に敷く面）の上の文字を `opacity` で薄くしない — 背景が透けたぶんコントラストが落ち、4.5:1 を割る
- 金額カードの文字色 `--text-on-kpi` を他の面に流用しない — だーりんでは濃色のため、濃い面（`--text-primary` 等）の上では読めない
