---
name: backlog-ready
description: open Issue を分析し、Claude が無人で処理できるものに ready-to-implement ラベルを付ける。バックログのトリアージや「ready 化して」と依頼されたときに使用する。
---

# バックログの ready 化

open Issue を判定基準にかけ、無人消化 Routine(`docs/automation/backlog-routine.md`)の対象にしてよいものへ `ready-to-implement` ラベルを付ける。

ワークフロー上の実行タイミング:

- **Issue 作成時**: `/issue-create` が手順4で同じ基準を新規 Issue に適用する(本スキルの部分実行)
- **PR マージ後(任意)**: 依存待ちの ready Issue は次の fire が自動で拾うため、再実行は必須ではない。受け入れ条件の曖昧さなど依存以外の理由で見送っていた Issue の再判定に使う
- **随時**: バックログ全体のトリアージとして

**ready 化 = 無人実装の承認**である。判定は保守的に行い、迷ったら付けない(付け損ねてもユーザーが手動で付けられるが、誤って付けると無人セッションが走ってしまう)。

> `gh` CLI が使えない環境では GitHub MCP ツールで同等の操作を行う(issue-work スキルの「実行環境の注意」と同じ)。

## 手順

### 1. 対象 Issue の取得

```bash
gh issue list --state open --json number,title,labels,assignees,body,createdAt
```

以下は判定対象から除外する:

- `ready-to-implement` / `status:in-progress` / `needs-decision` ラベルが既に付いているもの
- 誰かに assign 済みのもの

### 2. 判定基準(すべて満たしたら ready)

1. **リポジトリ内で完結する**: コード・ドキュメントの変更と CI だけで受け入れ条件を満たせる。以下は不可:
   - 本番インフラの構築・デプロイ・シークレット設定(AWS・Neon・LINE チャネル等)
   - 実機・実環境での手動確認や人手の受入テストが完了条件に含まれる
   - 外部サービス側の設定作業や、リポジトリに無い情報(実メールのサンプル等)が前提
2. **受け入れ条件が検証可能**: チェックボックスで書かれている、または本文から「何ができたら完了か」が一意に導ける
3. **依存の扱い**: 本文の「依存」「先行」に挙げられた Issue が open でも、他の基準を満たすなら付与してよい(着手は Routine 側の依存チェックが先行 Issue のクローズまで自動で遅延する)。ただし先行 Issue の実装結果次第で本 Issue の受け入れ条件やアプローチが変わりうる場合は付与せず、マージ後に再判定する
4. **設計判断が残っていない**: 「検討事項」「要検討」「〜するか判断」など未解決の分岐が本文に残っていない(実装者の裁量範囲の些細な選択は可)
5. **1 PR 粒度**: 1つの PR で完結する大きさ

### 3. ラベル付与

ready と判定した Issue に付与する(ラベルは冪等に作成):

```bash
gh label create "ready-to-implement" --color 0E8A16 --description "無人実装してよい" 2>/dev/null || true
gh issue edit <番号> --add-label "ready-to-implement"
```

ready が複数ある場合、Routine は優先順(`priority:high` → 古い順)と依存チェックで拾う。依存関係のある Issue 群は同時に ready にしてよく、先行 Issue のクローズ順に自動で消化される。順序を強制したいときは `priority:high` を使うか、先行させたい Issue だけを ready にする。

### 4. 報告

以下を表で報告する:

- **ready 化した Issue**: 番号・タイトル・判定理由の要点
- **見送った Issue**: 番号・タイトル・理由(人手が必要 / 受け入れ条件が曖昧 / 設計判断が残存 / 粒度過大 / 依存先の実装結果待ちで判定不能)

見送り理由が「受け入れ条件が曖昧」「粒度過大」のものは、`/issue-create` の基準(検証可能なチェックボックス・1 Issue = 1 PR)での書き直し・分解を提案する。ラベルはいつでも手動で外して取り消せることを添える。
