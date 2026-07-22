# ユビキタス言語: 取引取込

> 親: [docs/domain/08-ubiquitous-language.md](./08-ubiquitous-language.md)
> サブドメイン: Supporting（07-bounded-contexts.md §2.2）

## 責務

Gmail 経由で受信した SMBC／Amazon 通知メールおよびユーザーがアップロードした明細 CSV／PDF をパース・変換・重複除外し、内部表現の取引候補として下流（自動分類・学習、残高・資産推移管理、家計分析）に供給する。Gmail OAuth 取得は持たず参照のみ（オンボーディング・認証から借用）。Anthropic API による PDF→CSV 変換と Gmail message ID による重複検出を ACL（翻訳層）として担う。

## 1. データ（data）

```
// 本コンテキストの中核は「取引候補」（下流に渡す内部表現）と、
// 取込起因として束ねる「日次メール取込バッチ」「CSV/PDF 取込ジョブ」の 2 集約。
// 外部スキーマ（SMBC通知メール本文／Amazon 注文確認メール本文／明細CSV／明細PDF）は外部表現として受け取り、
// 内部 data に翻訳して下流に渡す。

// クロスコンテキスト参照（ID のみ借用）
// referenced from: オンボーディング・認証
data ユーザーID = 文字列
data Gmail_OAuth_トークン参照 = ユーザーID  // 実体はオンボーディング・認証が保有

// 共通語彙の借用
data Gmail_message_ID = 文字列
data 加盟店名 = 文字列
data 金額 = 整数
data 発生日時 = 日時

// --- 外部スキーマ（ACL 入力側） ---
// 外部表現はパース前は構造を持たないので「本文」として包む。

data SMBC通知メール本文 = Gmail_message_ID
   AND 受信日時
   AND 件名
   AND 本文文字列
   AND メール種別ヒント

data メール種別ヒント = 利用通知ヒント OR 入金通知ヒント OR 出金通知ヒント OR 引落確定通知ヒント OR 返金通知ヒント OR ヒント不明
// ヒントは件名や送信元アドレスから類推した暫定種別。確定はパース成功後。

data Amazon注文確認メール本文 = Gmail_message_ID
   AND 受信日時
   AND 件名
   AND 本文文字列

data 明細CSV = アップロードファイルID
   AND アップロード日時
   AND アップロード者ユーザーID
   AND CSV種別
   AND 文字エンコーディング
   AND 行データ

data CSV種別 = カード明細CSV OR 銀行明細CSV
data 文字エンコーディング = SJIS_CP932 OR UTF8 OR その他エンコーディング

data 明細PDF = アップロードファイルID
   AND アップロード日時
   AND アップロード者ユーザーID
   AND PDF種別
   AND PDFバイナリ参照

data PDF種別 = カード明細PDF OR 銀行明細PDF

data アップロードファイルID = 文字列

// --- パース結果（内部表現） ---

data SMBC通知パース結果 = カード利用通知 OR 銀行入金通知 OR 銀行出金通知 OR カード引落確定通知 OR カード返金通知 OR パース失敗

data カード利用通知 = Gmail_message_ID AND ユーザーID AND 加盟店名 AND 金額 AND 発生日時 AND カード種別
data 銀行入金通知 = Gmail_message_ID AND ユーザーID AND 振込元名 AND 金額 AND 発生日時 AND 摘要?
data 銀行出金通知 = Gmail_message_ID AND ユーザーID AND 振込先名 AND 金額 AND 発生日時 AND 摘要?
data カード引落確定通知 = Gmail_message_ID AND ユーザーID AND 引落合計金額 AND 引落日 AND 対象月
data カード返金通知 = Gmail_message_ID AND ユーザーID AND 加盟店名 AND 返金金額 AND 返金日時

data カード種別 = 三井住友カード
data 振込元名 = 文字列
data 振込先名 = 文字列
data 摘要 = 文字列

data パース失敗 = Gmail_message_ID AND 失敗理由 AND 検知日時
data 失敗理由 = 本文構造不一致 OR 必須フィールド欠落 OR 文字化け OR その他パース失敗

data Amazon注文情報 = Amazon注文ID
   AND ユーザーID
   AND Gmail_message_ID
   AND 注文日時
   AND 注文合計金額
   AND List<Amazon商品情報>

data Amazon注文ID = 文字列  // Amazon 側の注文番号
data Amazon商品情報 = 商品名 AND Amazon商品キー AND 商品金額
data Amazon商品キー = 文字列  // 商品カテゴリ表記
data 商品名 = 文字列
data 商品金額 = 整数

// --- 取引候補（下流に渡す内部表現） ---
// 自動分類・学習が消費する。

// aggregate root
data 取引候補 = 通常取引候補 OR Amazon突合取引候補 OR 突合タイムアウト未分類候補

data 取引候補共通属性 = 取引候補ID
   AND ユーザーID
   AND 取込ソース
   AND 加盟店名
   AND 金額
   AND 発生日時

data 取引候補ID = 文字列

data 取込ソース = メール由来 OR CSV由来 OR PDF由来 OR Amazon突合由来 OR 手動入力由来
data メール由来 = Gmail_message_ID
data CSV由来 = アップロードファイルID AND 行番号
data PDF由来 = アップロードファイルID AND ページ番号 AND PDF変換ジョブID
data Amazon突合由来 = SMBC_Gmail_message_ID AND Amazon注文ID
data 手動入力由来 = 入力日時 AND 入力者ユーザーID

data 通常取引候補 = 取引候補共通属性
data Amazon突合取引候補 = 取引候補共通属性 AND List<Amazon商品情報> AND 突合確定日時
data 突合タイムアウト未分類候補 = 取引候補共通属性 AND タイムアウト到達日時 AND タイムアウト方向

data タイムアウト方向 = SMBC先着Amazon待ちタイムアウト OR Amazon先着SMBC待ちタイムアウト

// --- 重複検出（ACL の責務） ---

data 重複判定結果 = 重複あり OR 重複なし

data 重複あり = 既存取引候補ID AND 検出根拠 AND 検出日時
data 重複なし = 検出日時

data 検出根拠 = Gmail_message_ID重複 OR 三項一致重複
data Gmail_message_ID重複 = Gmail_message_ID
data 三項一致重複 = 発生日 AND 金額 AND 加盟店名

// --- 日次メール取込バッチ（集約） ---
// バッチ単位を集約として保持し、起動～終了のライフサイクルを管理する。

// aggregate root
data 日次メール取込バッチ = 起動済みバッチ OR 取込中バッチ OR 完了バッチ OR 失敗バッチ

data バッチ共通属性 = バッチID
   AND ユーザーID
   AND バッチ起動日時
   AND 取込対象期間
data バッチID = 文字列
data 取込対象期間 = 開始日時 AND 終了日時  // 過去 5 日以前を毎回スキャン（論点22）

data 起動済みバッチ = バッチ共通属性
data 取込中バッチ = バッチ共通属性 AND 取込開始日時 AND 取込件数
data 完了バッチ = バッチ共通属性 AND 完了日時 AND 取込件数 AND 重複除外件数 AND 失敗件数
data 失敗バッチ = バッチ共通属性 AND 失敗日時 AND 失敗理由

// --- CSV/PDF 取込ジョブ（集約） ---

// aggregate root
data 明細取込ジョブ = アップロード受付済みジョブ OR PDF変換中ジョブ OR フォーマット検証中ジョブ OR 取込中ジョブ OR 完了ジョブ OR 失敗ジョブ

data ジョブ共通属性 = 取込ジョブID
   AND アップロード者ユーザーID
   AND 取込対象月
   AND ファイル種別
   AND ファイル参照

data 取込ジョブID = 文字列
data 取込対象月 = 年月
data ファイル種別 = カード明細 OR 銀行明細
data ファイル参照 = アップロードファイルID

data アップロード受付済みジョブ = ジョブ共通属性 AND 受付日時
data PDF変換中ジョブ = ジョブ共通属性 AND PDF変換ジョブID AND 変換開始日時
data フォーマット検証中ジョブ = ジョブ共通属性 AND 検証開始日時
data 取込中ジョブ = ジョブ共通属性 AND 取込開始日時 AND 処理済件数
data 完了ジョブ = ジョブ共通属性 AND 完了日時 AND 取込結果サマリ
data 失敗ジョブ = ジョブ共通属性 AND 失敗日時 AND 取込失敗理由

data 取込結果サマリ = 新規件数 AND 自動分類見込件数 AND 未分類見込件数 AND 重複除外件数

data 取込失敗理由 = PDF変換失敗 OR フォーマット検証失敗 OR 取込中エラー
data PDF変換失敗 = 変換失敗理由 AND 失敗詳細 AND 検知日時
data フォーマット検証失敗 = 失敗詳細 AND 検知日時
data 取込中エラー = 失敗詳細 AND 検知日時
data 失敗詳細 = 文字列

// --- PDF→CSV 変換ジョブ（Anthropic API 呼出 ACL） ---

data PDF変換ジョブID = 文字列

data PDF変換結果 = 変換成功 OR 変換失敗

data 変換成功 = PDF変換ジョブID AND 生成CSV参照 AND 変換完了日時
data 生成CSV参照 = アップロードファイルID
data 変換失敗 = PDF変換ジョブID AND 変換失敗理由 AND 検知日時
data 変換失敗理由 = API呼出失敗 OR レスポンス構造不正 OR 行数不一致 OR 合計金額不一致 OR タイムアウト
```

## 2. 振る舞い（behavior）

```
// --- ACL 翻訳層: Gmail → 内部表現 ---

behavior Gmail からメールを取得する = Gmail_OAuth_トークン参照 AND 取込対象期間 -> List<SMBC通知メール本文> AND List<Amazon注文確認メール本文> AND メール取得失敗?
// 事前: Gmail OAuth トークンが有効（オンボーディング・認証から借用）
// 事後: 過去 5 日以前を毎回スキャンし、Gmail message ID を保持する
// 事後: トークン失効を検知したら 取得失敗 を返し、オンボーディング・認証と通知配信に通知

data メール取得失敗 = 失敗理由 AND 検知日時 AND OAuth失効状態
data OAuth失効状態 = OAuth失効検知 OR その他取得失敗

behavior SMBC通知メール本文をパースする = SMBC通知メール本文 -> SMBC通知パース結果 OR パース失敗
// 事前: メール本文がプレーンテキスト or HTML 形式で受信済み
// 事後: メール種別ヒントから本文構造を選択し、必須フィールドを抽出する
// 事後: 加盟店名は NFKC 正規化＋空白圧縮＋長音統一 を適用する（OQ-23）
// 事後: パース失敗の場合は通知配信のフェイルセーフ対象としてマークする

behavior Amazon注文確認メール本文をパースする = Amazon注文確認メール本文 -> Amazon注文情報 OR パース失敗
// 事前: メール本文に商品名・カテゴリ・合計金額が含まれる構造
// 事後: 商品カテゴリ表記を Amazon商品キー として抽出する

// --- 重複検出（ACL の責務） ---

behavior メールの重複を判定する = Gmail_message_ID -> 重複判定結果
// 事前: 過去 5 日以前のメール再スキャンで再取得された可能性がある
// 事後: Gmail message ID 一致なら 重複あり、なければ 重複なし

behavior CSV取引の重複を判定する = CSVから抽出した取引候補 AND 既存取引候補リスト -> 重複判定結果
// 事前: CSV 取込で抽出された取引候補
// 事後: 発生日・金額・加盟店名（NFKC 正規化済み）の三項一致で判定

data CSVから抽出した取引候補 = 通常取引候補

// --- 取引候補の生成 ---

behavior カード利用通知から取引候補を生成する = カード利用通知 -> 通常取引候補 AND 取引候補抽出済みイベント
// 事前: パース成功
// 事後: 取込ソース = メール由来

behavior CSVから取引候補を生成する = 明細CSV AND 取込ジョブID -> List<通常取引候補> AND CSV取込完了イベント OR 取込失敗ジョブ
// 事前: フォーマット検証成功
// 事後: 取込ソース = CSV由来
// 事後: 重複除外を適用したのち下流に通知

behavior PDFから取引候補を生成する = 明細PDF AND 取込ジョブID -> List<通常取引候補> AND CSV取込完了イベント OR 取込失敗ジョブ
// 事前: PDF→CSV 変換が成功
// 事後: 取込ソース = PDF由来

behavior Amazon注文とSMBCカード利用通知を突合する = Amazon注文情報 AND List<カード利用通知> -> Amazon突合取引候補 OR Amazon突合保留
// 事前: 双方が金額・タイミングで一致候補となる
// 事後: 一致したら Amazon突合取引候補 を生成、しなければ Amazon突合保留 として自動分類・学習へ判定を委ねる

data Amazon突合保留 = Amazon注文ID AND 受信日時 AND タイムアウト期限

// --- ACL 翻訳層: PDF → CSV（Anthropic API 呼出） ---

behavior PDFをCSVに変換する = 明細PDF -> 変換成功 OR 変換失敗
// 事前: Anthropic API キーが有効
// 事前: 13 列構造（カード明細）のプロンプトテンプレートを保持
// 事後: 行数・利用金額合計を検証して構造一致を確認（OQ-23）
// 事後: 変換成功なら生成 CSV を CSV 取込ジョブに合流させる
// 事後: 変換失敗なら通知配信に PDF 変換失敗をユーザーに通知する依頼を発火

// --- バッチ・ジョブのライフサイクル ---

behavior 日次メール取込バッチを起動する = ユーザーID AND 起動日時 -> 起動済みバッチ AND バッチ起動イベント
// 事前: ユーザーが Gmail OAuth 連携を完了している
// 事前: 運用開始日時を経過している
// 事後: EventBridge から日次に起動される

behavior 日次バッチを完了する = 取込中バッチ AND 完了結果 -> 完了バッチ AND バッチ完了イベント
data 完了結果 = 取込件数 AND 重複除外件数 AND 失敗件数

behavior 明細取込ジョブを起動する = アップロード受付済みジョブ -> PDF変換中ジョブ OR フォーマット検証中ジョブ
// 事前: ファイル種別が PDF なら PDF変換中ジョブ、CSV ならフォーマット検証中ジョブに遷移
// 事後: 状態遷移は単方向（後戻りなし、失敗時は失敗ジョブへ）

behavior フォーマット検証を実行する = フォーマット検証中ジョブ AND 明細CSV -> 取込中ジョブ OR 失敗ジョブ AND CSVフォーマット検証失敗イベント?
// 事後: 失敗時は通知配信にユーザー通知を依頼

behavior 明細取込ジョブを完了する = 取込中ジョブ AND 取込結果サマリ -> 完了ジョブ AND CSV取込完了イベント
// 事後: 月次レポートのトリガー条件を満たすか家計分析に通知する

// --- ユーザー操作 ---

behavior 明細CSV/PDFをアップロードする = アップロード者ユーザーID AND ファイル種別 AND ファイルバイナリ AND 取込対象月 -> アップロード受付済みジョブ AND ファイルアップロードイベント
```

## 3. ドメインイベント

```
data 日次メール取込バッチ起動イベント = バッチID AND ユーザーID AND 起動日時 AND 発生日時
data メール取得イベント = バッチID AND 取得件数 AND 発生日時
data 取引候補抽出済みイベント = 取引候補ID AND ユーザーID AND 取込ソース AND 発生日時
data Amazon商品情報抽出イベント = Amazon注文ID AND ユーザーID AND 商品キーリスト AND 発生日時
data Amazon注文SMBC突合イベント = Amazon注文ID AND SMBC_Gmail_message_ID AND 発生日時
data メールパース失敗イベント = Gmail_message_ID AND 失敗理由 AND 発生日時
data 重複除外イベント = Gmail_message_ID OR 取引候補ID AND 検出根拠 AND 発生日時
data ファイルアップロードイベント = 取込ジョブID AND ユーザーID AND ファイル種別 AND 発生日時
data PDF変換完了イベント = PDF変換ジョブID AND 取込ジョブID AND 発生日時
data PDF変換失敗イベント = PDF変換ジョブID AND 取込ジョブID AND 変換失敗理由 AND 発生日時
data CSVフォーマット検証失敗イベント = 取込ジョブID AND 失敗詳細 AND 発生日時
data CSV取込完了イベント = 取込ジョブID AND ユーザーID AND 取込結果サマリ AND 発生日時
data CSV重複除外イベント = 取込ジョブID AND 取引候補ID AND 検出根拠 AND 発生日時
data バッチ起動イベント = バッチID AND ユーザーID AND 発生日時
data バッチ完了イベント = バッチID AND 完了結果 AND 発生日時
data Gmail_OAuth失効検知イベント = ユーザーID AND 検知日時 AND 発生日時
data メール取込再開イベント = ユーザーID AND 再開日時 AND 発生日時
```

## 4. 隣接コンテキストとの境界

| 隣接 | 関係 | 翻訳層 behavior |
|---|---|---|
| Gmail（外部システム） | ACL（Anti-Corruption Layer） | `behavior Gmail からメールを取得する`／`behavior SMBC通知メール本文をパースする`／`behavior Amazon注文確認メール本文をパースする`／`behavior メールの重複を判定する` |
| Anthropic API（外部システム） | ACL（Anti-Corruption Layer） | `behavior PDFをCSVに変換する` |
| 自動分類・学習 | 顧客-供給者（下流: 取引候補・Amazon商品情報を供給） | `behavior カード利用通知から取引候補を生成する`／`behavior Amazon注文とSMBCカード利用通知を突合する` の出力イベント |
| 残高・資産推移管理 | 顧客-供給者（下流: 残高変動の根拠データを供給） | （上流側として `取引候補抽出済みイベント` を発火、受信側翻訳層は残高側） |
| 家計分析 | 顧客-供給者（下流: CSV 取込完了で月次レポート CSV確定昇格をトリガー） | `behavior 明細取込ジョブを完了する` の出力 `CSV取込完了イベント` |
| 通知配信 | 顧客-供給者（下流: PDF 変換失敗・CSV フォーマット検証失敗・OAuth 失効をユーザーに通知依頼） | `behavior PDFをCSVに変換する`／`behavior フォーマット検証を実行する`／`behavior Gmail からメールを取得する` の失敗パスでの通知依頼 |
| オンボーディング・認証 | 顧客-供給者（上流: Gmail OAuth トークン参照・運用開始日時・許可リストを供給） | `behavior 日次メール取込バッチを起動する` の事前条件として参照／`Gmail_OAuth失効検知イベント` を逆方向に発火（再認可フローの起点） |
