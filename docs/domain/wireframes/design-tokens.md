# デザイントークン

> 親: [Phase 3.5 spec §2](../../superpowers/specs/2026-05-01-phase3.5-ux-ui-design.md)
> 用途: Phase 4 戦術的設計（TS 型 + Zod）以降の UI 実装で参照する色・タイポ・余白の正本。

## 1. テーマカラー（per-user）

### 1.1 Darling（妻）テーマ

| トークン | 値 | 用途 |
|---|---|---|
| `--bg-gradient` | `linear-gradient(180deg, #ffc8d8 0%, #ffd8e0 30%, #ffe0e8 60%, #fff0f5 100%)` | パネル背景 |
| `--kpi-1` | `linear-gradient(135deg, #ff8aa8, #ffb0c5)` | KPI カード（標準） |
| `--kpi-hero` | `linear-gradient(135deg, #ee5d8a, #ff80a8)` | 資産合計カード |
| `--accent-rose` | `#ff7095` | アクセント |
| `--text-primary` | `#5a2840` | 主テキスト |
| `--text-secondary` | `#a04068` | 補助テキスト |
| `--text-on-kpi` | `#ffffff` | KPI カード上の数字 |

### 1.2 Honey（夫）テーマ

| トークン | 値 | 用途 |
|---|---|---|
| `--bg-gradient` | `linear-gradient(180deg, #98c0e0 0%, #b8d0e8 30%, #d0e0f0 60%, #e8f0f8 100%)` | パネル背景 |
| `--kpi-1` | `linear-gradient(135deg, #5888c0, #80a8d0)` | KPI カード（標準） |
| `--kpi-hero` | `linear-gradient(135deg, #2a5098, #4878b8)` | 資産合計カード |
| `--accent-royal` | `#5090d8` | アクセント |
| `--text-primary` | `#1a3868` | 主テキスト |
| `--text-secondary` | `#2a5098` | 補助テキスト |
| `--text-on-kpi` | `#ffffff` | KPI カード上の数字 |

## 2. カテゴリ色（テーマで色相のみ調整）

| カテゴリ | Darling | Honey |
|---|---|---|
| 住居光熱通信 | `#d8407a` | `#1a4080` |
| 食費 | `#ff6f90` | `#3878c8` |
| 娯楽 | `#ff9888` | `#48a8c0` |
| その他 | `#c870b0` | `#7080c0` |

## 3. アラート色（テーマ非依存）

| 用途 | 値 |
|---|---|
| 警告（黄） | `#fff5e0` 背景 / `#f0c878` 枠 / `#a05028` 文字 |
| 危険（赤） | `#ffe0e0` 背景 / `#f08080` 枠 / `#a02828` 文字 |
| 成功（緑） | `#dcf0e0` 背景 / `#9ace6a` 枠 / `#3a8068` 文字 |
| 通知バッジ | `#9ace6a` 背景 / `#fff` 文字（CSV確定） |

## 4. タイポグラフィ

```css
font-family: 'Hiragino Maru Gothic ProN', 'Yu Gothic', system-ui, -apple-system, sans-serif;

/* 重要数字（KPI 値）*/
font-size: 14px-16px;
font-weight: 700-800;

/* hero 数字（月次レポートのメイン）*/
font-size: 24px-30px;
font-weight: 800;

/* KPI ラベル */
font-size: 9px;
opacity: 0.95;
font-weight: 600;

/* 補助情報 */
font-size: 8px-9px;
opacity: 0.55-0.85;
```

## 5. 角丸・シャドウ

| 要素 | 値 |
|---|---|
| カード（標準） | `border-radius: 14px` |
| ヒーローカード | `border-radius: 14px` + `border: 2px solid` |
| パネル全体 | `border-radius: 20px` |
| ボタン | `border-radius: 9-12px` |
| ピル（バッジ） | `border-radius: 12-14px` |
| シャドウ標準 | `box-shadow: 0 2px 8px <theme>20` |
| シャドウ強 | `box-shadow: 0 4px 14px <theme>50` |

## 6. 余白

| 用途 | 値 |
|---|---|
| カード内 padding | `11px-12px` |
| カード間 gap | `6px-10px` |
| パネル padding | `14px` |
| 画面幅 | `300px`（LIFF スマホ縦想定） |

## 7. 装飾要素

- 背景に opacity 0.4 で散らす絵文字（Darling: ✨ ♡ 🌸 / Honey: ✦）
- 重要 KPI（資産合計）に隅装飾（✨）
- ストロークは丸キャップ（`stroke-linecap="round"`）でドーナツチャートをキュート化

## 8. 役割別アバター絵文字

| ロール | 絵文字 | 表記例 |
|---|---|---|
| Honey（夫） | ⛵ | 「⛵ コウキ」 |
| Darling（妻） | 🌸 | 「🌸 ななみ」 |
