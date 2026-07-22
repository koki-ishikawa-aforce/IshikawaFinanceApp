---
name: backlog-ready
description: open Issue を分析し、Claude が無人で処理できるものに ready-to-implement ラベルを付ける。バックログのトリアージや「ready 化して」と依頼されたときに使用する。
---

# バックログの ready 化

open Issue を判定基準にかけ、無人消化 Routine(`docs/automation/backlog-routine.md`)の対象にしてよいものへ `ready-to-implement` ラベルを付ける。

**ready 化 = 無人実装の承認**である。判定は保守的に行い、迷ったら付けない(付け損ねてもユーザーが手動で付けられるが、誤って付けると無人セッションが走ってしまう)。

> `gh` CLI が使えない環境では GitHub MCP ツールで同等の操作を行う(issue-work スキルの「実行環境の注意」と同じ)。

## 手順

### 1. 対象 Issue の取得

```bash
gh issue list --state open --json number,title,labels,assignees,body,createdAt
```

以下は判定対象から除外する:

- `ready-to-implement` / `status:in-progress` / `needs-clarification` ラベルが既に付いているもの
- 誰かに assign 済みのもの

### 2. 判定基準(すべて満たしたら ready)

1. **リポジトリ内で完結する**: コード・ドキュメントの変更と CI だけで受け入れ条件を満たせる。以下は不可:
   - 本番インフラの構築・デプロイ・シークレット設定(AWS・Neon・LINE チャネル等)
   - 実機・実環境での手動確認や人手の受入テストが完了条件に含まれる
   - 外部サービス側の設定作業や、リポジトリに無い情報(実メールのサンプル等)が前提
2. **受け入れ条件が検証可能**: チェックボックスで書かれている、または本文から「何ができたら完了か」が一意に導ける
3. **依存が解決済み**: 本文の「依存」「先行」に挙げられた Issue がすべてクローズ済み
4. **設計判断が残っていない**: 「検討事項」「要検討」「〜するか判断」など未解決の分岐が本文に残っていない(実装者の裁量範囲の些細な選択は可)
5. **1 PR 粒度**: 1つの PR で完結する大きさ

### 3. ラベル付与

ready と判定した Issue に付与する(ラベルは冪等に作成):

```bash
gh label create "ready-to-implement" --color 0E8A16 --description "無人実装してよい" 2>/dev/null || true
gh issue edit <番号> --add-label "ready-to-implement"
```

ready が複数ある場合の着手順は Routine が優先順(`priority:high` → 古い順)で拾うため、順序を制御したいときは先行させたい Issue だけを ready にする(依存関係があるのに同時 ready にしない)。

### 4. 報告

以下を表で報告する:

- **ready 化した Issue**: 番号・タイトル・判定理由の要点
- **見送った Issue**: 番号・タイトル・理由(依存未解決 / 人手が必要 / 受け入れ条件が曖昧 / 設計判断が残存 / 粒度過大)

見送り理由が「受け入れ条件が曖昧」「粒度過大」のものは、`/issue-create` の基準(検証可能なチェックボックス・1 Issue = 1 PR)での書き直し・分解を提案する。ラベルはいつでも手動で外して取り消せることを添える。
