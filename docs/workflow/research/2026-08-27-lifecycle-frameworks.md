# 開発ライフサイクルの網羅性を測る知識体系の調査

> 作成: 2026-08-27(対話セッションでの調査)
> 共有用ページ: [Artifact 版](https://claude.ai/code/artifact/edfb26f3-6b6d-4cf1-8b83-c65f69a7d6e6)(本ファイルを正とする)
> 関連: [2026-08-27-workflow-external-review.md](./2026-08-27-workflow-external-review.md)(本調査のきっかけとなった外部レビュー記録)

オーナーの気づきに依存せず工程の欠落を検出するため、外部の標準・フレームワーク12体系を調査し、既知の欠落6件への検出力を逆引きで実証した。

**結論**: 単独で全欠落を検出できる体系は無く、無償4体系のポートフォリオ(SWEBOK v4 + DORA + AWS Well-Architected + OWASP SAMM)で 6/6 を検出できる。

## 1. 背景 — なぜ外部の物差しが要るか

わりまるのワークフローは自己改善ループ(`/retro` → `/decide`)を持つが、その視野は「動いている工程の失敗データ」と「自分自身の基準(`05-criteria.md`)」に閉じている。外部レビューで、CD・設計工程などの構造的欠落は**オーナーが指摘しない限り誰にも検出されない**ことが判明した。動いていない工程は失敗データを生まないため、`/retro` には原理的に見えない(詳細は [外部レビュー記録](./2026-08-27-workflow-external-review.md) §2)。

このリポジトリには前例がある — `docs/review/README.md` §2 は ISO/IEC 25010 を「プロダクト品質の物差し」として対応表化し、抜けを可視化している。同じパターンを**ライフサイクル全体**に適用できる体系を探すのが本調査の目的。

### 評価軸

1. **カバー範囲** — 要件〜設計〜実装〜検証〜リリース〜運用〜保守のどこを覆うか
2. **形式知性** — ID・項目名付きで列挙されており、AI スキルが機械的に突合できるか
3. **重さ** — 1人 + AI エージェントの無人運用体制にテーラリングできるか
4. **入手性** — 無償で参照できるか(有償なら項目名レベルの公開情報で運用できるか)
5. **検出力の実証** — 既知の欠落6件を「その体系のどの項目が検出できたか」で逆引き検証(最重要)

### 検出力テストに使った既知の欠落

- **(a)** CD/デプロイ工程が存在しない(マージまでで止まり本番に届かない)
- **(b)** 本番 DB のバックアップ・リストア方針が未定義
- **(c)** 要件→実装の間に設計工程が存在しない(設計成果物が残らない)
- **(d)** 依存パッケージ更新の自動化がない(脆弱性検知 CI はあるが修復は人手)
- **(e)** 自動化ワークフロー自身の実行ログ・メトリクスが構造化されて残らない
- **(f)** リポジトリへのシークレット混入検知が未設定

## 2. 候補12体系の評価一覧

凡例: ◎=強い / ○=使える / △=条件付き / ✕=不適。「検出」列は欠落6件のうち直接〜部分検出できた数。

| 体系(最新版)                | 性格                            | カバー範囲                                                                                                  | 形式知性                                                                | 重さ                                                | 入手性                        | 検出              |
| ----------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------- | ----------------- |
| SWEBOK v4 (2024)              | 知識体系の地図(IEEE)          | 全域+基礎知識。v4 で Operations / Architecture / Security の3 KA が新設                                    | ◎ 18 KA × トピック階層                                                 | ◎ 最軽量(適合義務なし)                           | ◎ **全文無償**(個人利用)   | 5/5               |
| ISO/IEC/IEEE 12207:2026       | ライフサイクルプロセス規格      | 全域(取得〜廃棄)。4グループ・30プロセス                                                                  | ◎ プロセス名+目的                                                     | ○ プロセス名の物差し利用なら軽い(軽量版に 29110) | △ 本文有償・一覧は無償で足る | 4/5               |
| ISO/IEC/IEEE 15288:2023       | システム版 12207                | 12207 と同一の30プロセス                                                                                     | ◎(同左)                                                              | ✕ ソフト単体には過剰                                | △ 同上                        | 4/5               |
| CMMI V3.0 (2023)              | プロセス成熟度モデル            | プロセス経営中心。8ドメイン・31 PA                                                                           | ○ PA 名は公開・本文非公開                                              | △ 正式適用は非現実的。PA 名利用のみ可              | △ 本文有償                    | 5/5               |
| DORA (2024/2025)              | デリバリー能力の実証研究        | 実装〜リリース〜運用(監視)。要件・設計は薄い                                                              | ◎ 29 capabilities + Four Keys(2025 は AI Capabilities Model 7項目追加) | ◎ 無人運用と最も親和的                              | ◎ 完全無償                    | 3/5               |
| Google SRE (Book/Workbook)    | 運用工学の正典                  | リリース〜運用〜保守が厚い                                                                                   | ○ 章・概念名(質問票形式ではない)                                     | ○ SLO/Error Budget 等のつまみ食いが現実的           | ◎ 3冊全文無償                 | 4/5               |
| ITIL 4                        | IT サービスマネジメント         | 運用・保守が最厚。34プラクティス                                                                             | △ 名称のみ無償・詳細有償                                                | ✕ 組織前提。概念の借用のみ                          | ✕ 一次資料有償                | 5/5(概念レベル) |
| AWS Well-Architected          | 設計・運用レビュー質問票        | 設計〜運用。要件は対象外。6本柱・57質問+BP                                                                  | ◎ 最高(ID 付き質問票、Serverless Lens あり)                          | ○ 柱・質問単位で部分適用可                          | ◎ 完全無償(WA Tool も無料)  | 5/5               |
| NIST SSDF v1.1                | セキュア開発プロセス規範        | 準備〜リリース。運用は対象外                                                                                 | ◎ 4グループ・19プラクティス(ID 付き)                                 | ○ テーラリング前提                                  | ◎ 無償(v1.2 改訂中)         | 4/6(部分含む)   |
| OWASP SAMM v2                 | セキュア開発の成熟度モデル      | **戦略〜運用まで全域**(セキュリティ系で唯一 Operations を持つ)                                            | ◎ 5機能 × 15プラクティス × 成熟度3段階                                | ○ L1 限定+Governance 縮退で個人適用可              | ◎ 無償(CC BY-SA)            | **6/6**           |
| OWASP ASVS 5.0 (2025)         | プロダクト検証標準              | 成果物のセキュリティ要件(プロセスは対象外)                                                                | ◎ 約350要件(ID 付き・CSV 配布)                                       | ○ L1 に絞れば現実的                                 | ◎ 無償                        | 2/6               |
| AI エージェント運用(領域)   | **確立した標準は不在**          | OWASP Agentic Top 10 (2026)・LLM Top 10 (2025)、Anthropic エンジニアリングガイド、METR 評価枠組みが最接近    | △ Top 10 系は ID 付き、ガイドは散文                                     | ◎ この体制がまさに主対象                            | ◎ 無償                        | (e) のみ直撃      |

補足:

- 15288 は 12207 とプロセス一覧が同一のため、ソフト単体開発では 12207 に吸収して扱ってよい
- SSDF は連邦調達文脈でのデファクトだが、検出範囲は SAMM にほぼ包含される。v1.2 が改訂中(2025-12 IPD)のため現行の引用は v1.1
- SP 800-218A(生成 AI 向け SSDF 補遺)は「AI モデルを作る側」向けであり、「AI が開発する」工程の規範ではない

## 3. 検出力マトリクス — どの体系がどの欠落を捕まえたか

「人間の指摘で見つかった欠落を、その体系を物差しに使っていれば検出できたか」の逆引き結果。セル内は該当する実際の項目名。

| 欠落                          | SWEBOK v4                              | 12207                                  | DORA                                            | AWS WA                                   | SRE                              | SAMM v2                                  | SSDF/ASVS               | CMMI                        |
| ----------------------------- | -------------------------------------- | -------------------------------------- | ----------------------------------------------- | ---------------------------------------- | -------------------------------- | ---------------------------------------- | ----------------------- | --------------------------- |
| (a) CD 不在                   | ◎ KA6 Operations(CI/CD・デプロイ)   | ◎ Transition process                   | ◎ Continuous Delivery / Deployment Frequency=∞ | ◎ OPS 6 / REL 8                          | ◎ Release Engineering            | ◎ Secure Deployment (SD-A)               | △ PO.3 間接             | △ SDM 経由のみ              |
| (b) バックアップ未定義        | ○ KA6 Operations(運用継続)          | △ Operation 間接                       | ✕                                               | ◎ REL 9(リストア試験まで)/ REL 13     | ◎ Ch.26 Data Integrity           | ◎ Data Protection (OM-A)                 | ✕                       | ◎ Continuity (CONT)         |
| (c) 設計工程不在              | ◎ KA2 Architecture / KA3 Design       | ◎ Architecture / Design Definition     | ✕                                               | △ REL 3 間接                             | ○ NALSD / Launch 部分            | ◎ Design 機能全体(脅威モデリング含む) | ◎ SSDF PW.1 / PW.2      | ◎ Technical Solution (TS)   |
| (d) 依存更新の自動化なし      | ◎ KA13 Security(サプライチェーン)   | ✕                                      | △ Pervasive Security 部分                       | ◎ SEC06-BP01(パッチ自動化を明記)       | ✕                                | ◎ Patching and Updating (EM-B)           | ○ ASVS 15.1.1 / 15.2.1  | ○ MST(Security ドメイン)  |
| (e) 自動化自身の可観測性なし  | ○ KA6 + プロセス測定                  | ◎ Measurement / Information Mgmt       | ○ Four Keys 計測の要請                          | ○ OPS 4 / OPS 8                          | ○ 自動化をサービスとして監視     | △ SM / IM 部分                           | △ SSDF PO.3.3 部分      | ◎ MPM / II                  |
| (f) シークレット混入検知なし  | △ KA13 一般論                          | ✕                                      | ✕                                               | ○ SEC 系 BP                              | ✕                                | ◎ Secret Management (SD-B)               | ◎ ASVS 13.3.1           | ✕                           |

**実証結果の要点** — 単独で 6/6 を直接検出できる体系は存在しない(SAMM v2 が最接近だが (e) は部分検出)。一方、**SWEBOK v4 + DORA + AWS WA + SAMM の4体系を重ねると 6/6 すべてを直接検出で覆える**。人間の指摘で見つけた欠落はすべて既存の知識体系の項目名から逆引きできた — つまり「体系を物差しにした定期監査」はこのワークフローで実際に機能する。

## 4. 推奨 — 役割分担のポートフォリオ

単一の体系ではなく、4つの無償体系に役割を分担させる。すべて既存の ISO 25010(プロダクト品質、`docs/review/README.md` §2)と住み分け可能。

| 役割                       | 体系                                    | 使い方                                                                                                                                                                                                                     |
| -------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 背骨(工程の網羅チェック) | **SWEBOK v4**                           | 18 知識領域を「うちのワークフローはこの領域を実装しているか」の網羅表にする。全文無償で読める唯一の全域体系。補助として ISO 12207 の30プロセス名(無償公開)をクロスチェックに使う                                          |
| デリバリーの KPI           | **DORA**(29 capabilities + Four Keys) | Four Keys(デプロイ頻度・リードタイム・変更失敗率・復旧時間)を基準11「到達性」の測り方として `05-criteria.md` に接続する。文化系9項目は1人体制では除外                                                                     |
| 運用・信頼性の具体点検     | **AWS Well-Architected**(OPS/REL/SEC) | ID 付き質問票(REL 9 バックアップ、REL 13 DR、SEC06-BP01 依存パッチ自動化、OPS 4/6/8 可観測性・デプロイ)をそのまま監査チェックリストにする。Serverless Lens が Lambda 構成に適用可。SRE からは SLO / Error Budget / ポストモーテム / Data Integrity (Ch.26) を設計原則として借用 |
| セキュアプロセスの成熟度   | **OWASP SAMM v2**                       | 15 プラクティス × 成熟度 L1 を年1回の自己評価に使う。検出力テスト最高成績。ASVS 5.0 は `/security-review` のチェック項目の中身(プロダクト検証)を供給する層として別枠で使う                                               |

### 採用しないもの(理由つき)

- **ISO 15288** — 12207 とプロセス一覧が同一で、ソフト単体開発への追加価値なし
- **ITIL 4** — 一次資料が有償・組織前提。Change Enablement(standard change の事前承認 = `ready-to-implement` ラベルの理論的裏付け)と Service Continuity の概念だけ借用
- **CMMI V3.0** — 本文有償・正式適用は非現実的。CONT(事業継続)等の PA 名は AWS WA の REL 9/13 で代替可能
- **NIST SSDF** — 検出範囲が SAMM にほぼ包含される。参照用に留める

### AI エージェント駆動開発について

「AI エージェントに開発を任せるワークフロー」自体の確立した標準は 2026-08 時点で**存在しない**。最接近は OWASP Top 10 for Agentic Applications(2026、ASI01〜ASI10)と Anthropic のエンジニアリングガイド群(長時間稼働エージェントのハーネス設計等)で、欠落 (e)(エージェント自身の可観測性)はこの領域だけが直撃する。裏を返せば、`docs/workflow/04-principles.md` はこの空白領域における先行事例そのものであり、外から輸入するだけでなく蓄積を続ける価値がある。

## 5. 決定と反映先

2026-08-27 の対話セッションで以下を採用決定(処理の経緯は外部レビュー記録を参照):

1. 基準11「到達性」を `05-criteria.md` に追加(DORA Four Keys で定義)
2. ライフサイクル網羅表(SWEBOK 18 KA × 担保手段 × 状態)を docs に新設
3. `/workflow-review` スキル新設+四半期 Routine(失敗データ駆動の `/retro` と相互補完)
4. `/retro` 手順5 に「観測可能な構造的欠落は証拠として扱える」但し書きを追加

実装はそれぞれ Issue として起票済み(各 Issue が本ファイルを参照する)。

### 留意点

- **物差しは網であって神託ではない。** 体系の項目を全部やるのが目的ではなく、「やらない」判断を明示的に記録する(テーラリング)。12207 も SAMM も取捨選択を公式に前提としている
- **チェックリスト演劇化のリスク。** 監査の出力は必ず `needs-decision` 経由で人間が採否を決める(承認ゲート1点の原則を崩さない)
- **版の追従。** SSDF v1.2(改訂中)・OWASP LLM Top 10 2026 年版など動きが速い領域は、網羅表に版数を記録し年1回見直す

## 6. 主要出典

- [SWEBOK v4 公式 PDF(無償)](https://ieeecs-media.computer.org/media/education/swebok/swebok-v4.pdf)
- [ISO/IEC/IEEE 12207:2026(IEEE SA)](https://standards.ieee.org/ieee/12207/11416/) / [12207 プロセス一覧(arc42)](https://quality.arc42.org/standards/iso12207)
- [DORA Capabilities カタログ](https://dora.dev/capabilities/) / [Four Keys ガイド](https://dora.dev/guides/dora-metrics/) / [AI Capabilities Model(2025)](https://dora.dev/ai/capabilities-model/report/)
- [Google SRE 3冊(全文無償)](https://sre.google/books/)
- [AWS Well-Architected 6本柱](https://docs.aws.amazon.com/wellarchitected/latest/framework/the-pillars-of-the-framework.html) / [REL 9(バックアップ)](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel-09.html) / [Serverless Applications Lens](https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/welcome.html)
- [NIST SSDF v1.1(SP 800-218)](https://nvlpubs.nist.gov/nistpubs/specialpublications/nist.sp.800-218.pdf)
- [OWASP SAMM v2 モデル](https://owaspsamm.org/model/) / [OWASP ASVS 5.0](https://github.com/OWASP/ASVS)
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/)
- [Anthropic: Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
- [METR(能力評価枠組み)](https://metr.org/research/)
- [CMMI V3.0 Quick Reference(無償 PDF)](https://processgroup.com/CMMI-Model-Quick-Reference-Guide_Digital-1024.pdf)
- [ITIL 4 の34プラクティス(解説)](https://itsm.tools/34-itil-4-management-practices/)
