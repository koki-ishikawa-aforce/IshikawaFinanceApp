---
name: issue-create
description: 要件をヒアリングして GitHub Issue を作成・分解する。新機能や改修の依頼をタスク化(Issue 化)するときに使用する。
---

# 要件の Issue 化

要件を「/issue-work でそのまま実装に入れる品質」の GitHub Issue に落とし込む。

## 手順

### 1. 要件の確認

以下が不明なら、実装の前提として AskUserQuestion で確認する:

- 目的(誰の何を解決するか)
- 受け入れ条件(何ができたら完了か)
- 対象の境界づけられたコンテキスト(見当がつかなければ `docs/domain/07-bounded-contexts.md` を読んで候補を提示)

### 2. 分解の提案

**1 Issue = 1 PR で完結する粒度**を基準にする。大きい要件は分解案(Issue のリスト)を提示してユーザーの合意を得てから作成する。依存関係がある場合は着手順も示す。

### 3. Issue 作成

`.github/ISSUE_TEMPLATE/task.md` の構造に沿って `gh issue create --title "..." --body "..."` で作成する。

- **受け入れ条件は検証可能なチェックボックス**で書く(「〜が pnpm test で通る」「〜画面で〜が表示される」など)。これが後で /issue-work の検証ループの終了条件になる
- 対象コンテキストを明記する
- 関連するドメイン資料(`docs/domain/09-aggregates.md` の該当集約など)を参考資料に挙げる

作成後、Issue の URL を一覧でユーザーに報告する。
