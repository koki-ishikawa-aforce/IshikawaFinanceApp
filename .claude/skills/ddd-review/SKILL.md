---
name: ddd-review
description: 変更差分を DDD・ヘキサゴナル観点でレビューする。PR 作成前や、集約・レイヤー配置などの設計判断に迷ったときに使用する。
---

# DDD レビュー

変更差分をプロジェクト固有の DDD 規約に照らしてレビューする。実際のレビューは `ddd-reviewer` サブエージェントが行う。

## 手順

1. `git diff main...HEAD --name-only` で変更範囲を確認する
2. `ddd-reviewer` サブエージェントを起動し、以下を渡す:
   - 変更ファイル一覧(またはレビュー対象の diff 範囲)
   - 関連する Issue 番号と受け入れ条件(あれば)
3. レビュー結果を **must-fix** / **suggestion** に分けてユーザーに提示する
4. must-fix があれば修正し、`/verify` を再実行して green を確認する。suggestion は対応するかユーザーに委ねる
