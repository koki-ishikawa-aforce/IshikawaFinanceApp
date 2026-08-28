# ユビキタス言語: マスタ管理

> 親: [docs/domain/08-ubiquitous-language.md](./08-ubiquitous-language.md)
> サブドメイン: Supporting（07-bounded-contexts.md §2.2）

## 責務

カテゴリマスタ（規定 4 種・世帯共有・削除改名不可／追加カテゴリ・個人別）と経費種別マスタ（規定 5 種・世帯共有／追加経費種別・個人別）の seed 投入・追加・改名・削除（移動先選択 + リマップ要請）と、経費種別の月次上限（個人別 seed・無制限フラグ・上限変更）と、Phase 0 デプロイ前提条件（LINE Channel 設定、Webhook 設定値、許可リスト投入）を担う（§1.1.3 確定）。削除時のリマップは下流コンテキスト（自動分類・学習／家計分析／経費精算）に依頼として発火する。

## 1. データ（data）

```
// 本コンテキストの中核は「カテゴリマスタ」「経費種別マスタ」「Phase0設定値」の 3 集約。
// それぞれ生成・改名・削除のライフサイクルを持つ。
// is_unlimited は専用カラム（論点15: マジックナンバー禁止、専用カラムで明示）。

// クロスコンテキスト参照（ID のみ借用）
// referenced from: オンボーディング・認証
data ユーザーID = 文字列
data LINE_userID = 文字列

// 共通語彙の借用
data 費用区分 = 世帯 OR 個人(夫) OR 個人(妻) OR 経費(会社)

// --- カテゴリマスタ: 集約ルート ---
// 規定 4 種は世帯共有・削除改名不可、追加カテゴリは個人別・追加改名削除可。
// 削除時は配下取引の移動先カテゴリ + 費用区分 をユーザーが選択し、本コンテキストはリマップ要請を発火する。

// aggregate root
data カテゴリマスタ = 規定カテゴリ OR 追加カテゴリ

data カテゴリマスタ共通属性 = カテゴリID
   AND カテゴリ名
   AND 所有スコープ

data カテゴリID = 文字列
data カテゴリ名 = 文字列

data 所有スコープ = 世帯共有スコープ OR 個人別スコープ
data 世帯共有スコープ = なし
data 個人別スコープ = ユーザーID

data 規定カテゴリ = カテゴリマスタ共通属性 AND 規定カテゴリ種別
// 所有スコープ = 世帯共有スコープ 固定、削除改名不可
data 規定カテゴリ種別 = 住居光熱通信 OR 食費 OR 娯楽 OR その他

data 追加カテゴリ = カテゴリマスタ共通属性 AND 作成日時 AND 作成者ユーザーID AND 改名履歴
// 所有スコープ = 個人別スコープ 固定

data 改名履歴 = List<改名記録>
data 改名記録 = 旧カテゴリ名 AND 新カテゴリ名 AND 改名日時 AND 改名者ユーザーID

// --- 経費種別マスタ: 集約ルート ---
// 規定 5 種は世帯共有・削除改名不可、追加経費種別は個人別・追加改名削除可。

// aggregate root
data 経費種別マスタ = 規定経費種別 OR 追加経費種別

data 経費種別マスタ共通属性 = 経費種別ID
   AND 経費種別名
   AND 所有スコープ

data 経費種別ID = 文字列
data 経費種別名 = 文字列

data 規定経費種別 = 経費種別マスタ共通属性 AND 規定経費種別種別
// 所有スコープ = 世帯共有スコープ 固定、削除改名不可
data 規定経費種別種別 = ジム OR 新聞図書費 OR AI利用費 OR 交通費 OR その他経費

data 追加経費種別 = 経費種別マスタ共通属性 AND 作成日時 AND 作成者ユーザーID AND 改名履歴

// --- 月次上限（経費種別ごと、個人別） ---
// 論点15: 無制限は専用カラムで明示。マジックナンバーは使わない。
// is_unlimited を OR の場合分けで表現することで「無制限なのに上限金額が入っている」状態を許容しない。

// aggregate root
data 月次上限 = 上限あり月次上限 OR 無制限月次上限

data 月次上限共通属性 = 月次上限ID
   AND ユーザーID
   AND 経費種別ID
   AND 適用開始日時

data 月次上限ID = 文字列

data 上限あり月次上限 = 月次上限共通属性
   AND 上限金額
   AND 変更履歴

data 上限金額 = 整数  // 円単位

data 無制限月次上限 = 月次上限共通属性
// 業務上「上限金額が入った無制限」状態を持たない。OR で完全に分離する。

data 変更履歴 = List<上限変更記録>
data 上限変更記録 = 旧上限金額 AND 新上限金額 AND 変更日時 AND 変更者ユーザーID AND 変更理由?
data 変更理由 = 文字列

// --- 削除リクエスト（リマップ依頼の起点） ---

data カテゴリ削除リクエスト = カテゴリ削除リクエストID
   AND 削除対象カテゴリID
   AND 削除依頼者ユーザーID
   AND 移動先カテゴリID
   AND 移動先費用区分
   AND 依頼日時
   AND 削除リクエスト状態

data カテゴリ削除リクエストID = 文字列

data 削除リクエスト状態 = リマップ依頼前 OR リマップ依頼済み OR リマップ完了 OR リマップ失敗

data リマップ依頼前 = 検証中
data リマップ依頼済み = 依頼日時 AND 依頼先コンテキスト一覧 AND 完了したコンテキスト一覧
data リマップ完了 = 完了日時 AND 影響取引数 AND 影響学習ルール数
data リマップ失敗 = 失敗日時 AND 失敗詳細

data 検証中 = なし
data 依頼先コンテキスト一覧 = List<依頼先コンテキスト>
data 依頼先コンテキスト = 家計分析依頼 OR 経費精算依頼 OR 自動分類学習依頼

// 依頼先コンテキストごとのリマップ完了通知を、届いた順に1件ずつ記録したもの。
// 不変条件: 依頼先コンテキスト一覧の部分集合であり、同一コンテキストの完了通知が2件以上並ばないこと
// （依頼していない、または重複したコンテキストからの完了通知は記録しない）。
data 完了したコンテキスト一覧 = List<完了したコンテキスト>
// 報告元コンテキストが扱わない件数（例: 自動分類学習依頼は影響取引数を持たない）は 0 として記録する。
data 完了したコンテキスト = 依頼先コンテキスト AND 影響取引数 AND 影響学習ルール数 AND 完了日時

data 経費種別削除リクエスト = 経費種別削除リクエストID
   AND 削除対象経費種別ID
   AND 削除依頼者ユーザーID
   AND 移動先経費種別ID
   AND 移動先費用区分
   AND 依頼日時
   AND 削除リクエスト状態

data 経費種別削除リクエストID = 文字列

// --- Phase 0 設定値（システム管理者投入の前提条件） ---
// §1.1.3 確定: マスタ管理に帰属。

// aggregate root
data Phase0設定値 = LINE_Channel設定 AND LINE_Webhook設定 AND 許可リスト設定

data LINE_Channel設定 = Channel_ID保管参照 AND Channel_Secret保管参照 AND Channel_Access_Token保管参照 AND 投入日時 AND LINE公式アカウント識別

data Channel_ID保管参照 = Parameter_Store_path
data Channel_Secret保管参照 = Parameter_Store_path
data Channel_Access_Token保管参照 = Parameter_Store_path
data Parameter_Store_path = 文字列
data LINE公式アカウント識別 = 文字列

data LINE_Webhook設定 = Webhook_URL AND バックエンド_Lambda_紐付け参照 AND 設定日時
data Webhook_URL = 文字列
data バックエンド_Lambda_紐付け参照 = 文字列

data 許可リスト設定 = HUSBAND_LINE_USER_ID保管参照 AND WIFE_LINE_USER_ID保管参照 AND 投入日時
data HUSBAND_LINE_USER_ID保管参照 = Parameter_Store_path
data WIFE_LINE_USER_ID保管参照 = Parameter_Store_path

data 許可リスト = 夫LINE_userID AND 妻LINE_userID
data 夫LINE_userID = LINE_userID
data 妻LINE_userID = LINE_userID
```

## 2. 振る舞い（behavior）

```
// --- カテゴリマスタの操作 ---

behavior 規定カテゴリをseed投入する = 規定カテゴリ種別 AND 投入日時 -> 規定カテゴリ AND カテゴリseed投入イベント
// 事前: Phase 0 デプロイ時、または DB 初期化時
// 事後: 4 種すべてが世帯共有スコープで一斉投入される

behavior 追加カテゴリを新設する = カテゴリ名 AND 作成者ユーザーID AND 作成日時 -> 追加カテゴリ AND カテゴリ追加イベント OR 名前重複エラー
// 事前: 同一ユーザーIDのカテゴリ名が未使用
// 事後: 所有スコープ = 個人別スコープ（作成者のみ）

data 名前重複エラー = カテゴリ名 OR 経費種別名 AND 検知日時

behavior 追加カテゴリを改名する = 追加カテゴリ AND 新カテゴリ名 AND 改名者ユーザーID -> 追加カテゴリ AND カテゴリ改名イベント
// 事前: 改名者ユーザーID = 作成者ユーザーID（個人別スコープ）
// 事後: 学習データは ID 参照のため副作用なし（論点42）

behavior 追加カテゴリの削除リクエストを受け付ける = 追加カテゴリ AND 移動先カテゴリID AND 移動先費用区分 AND 削除依頼者ユーザーID -> カテゴリ削除リクエスト
// 事前: 削除依頼者ユーザーID = 作成対象カテゴリの所有者
// 事前: 移動先カテゴリは規定カテゴリまたは残存追加カテゴリ
// 事後: 削除リクエスト状態 = リマップ依頼前

behavior カテゴリ削除リマップを依頼する = カテゴリ削除リクエスト -> カテゴリ削除リクエスト AND カテゴリ削除リマップ依頼イベント
// 事前: 削除リクエスト状態 = リマップ依頼前
// 事後: 家計分析（取引のカテゴリ移動）／自動分類・学習（学習データのリマップ）に依頼を発火
// 事後: 削除リクエスト状態 = リマップ依頼済み

behavior カテゴリ削除リマップ完了を受け取る = カテゴリ削除リクエスト AND 家計分析完了通知 AND 自動分類学習完了通知 -> カテゴリ削除リクエスト AND カテゴリ削除完了イベント
// 事前: 削除リクエスト状態 = リマップ依頼済み
// 事後: 削除リクエスト状態 = リマップ完了
// 事後: 元カテゴリは物理削除される
// 注: 本 behavior は両通知が揃った時点の概念上の最終遷移。実装では通知ごとに独立して届き、
// 片方だけ届いた間はリマップ依頼済みのまま完了したコンテキスト一覧に1件ずつ追記される（§1）。

data 家計分析完了通知 = カテゴリ削除リクエストID AND 影響取引数 AND 完了日時
data 自動分類学習完了通知 = カテゴリ削除リクエストID AND 影響学習ルール数 AND 完了日時

behavior 規定カテゴリの削除を拒否する = 規定カテゴリ AND 削除依頼 -> 削除拒否
// 事前: 規定カテゴリは削除改名不可
data 削除依頼 = カテゴリID AND 依頼日時
data 削除拒否 = カテゴリID AND 拒否日時 AND 拒否理由
data 拒否理由 = 規定マスタは削除不可

// --- 経費種別マスタの操作（カテゴリと同構造） ---

behavior 規定経費種別をseed投入する = 規定経費種別種別 AND 投入日時 -> 規定経費種別 AND 経費種別seed投入イベント

behavior 追加経費種別を新設する = 経費種別名 AND 作成者ユーザーID AND 作成日時 -> 追加経費種別 AND 経費種別追加イベント OR 名前重複エラー

behavior 追加経費種別を改名する = 追加経費種別 AND 新経費種別名 AND 改名者ユーザーID -> 追加経費種別 AND 経費種別改名イベント

behavior 追加経費種別の削除リクエストを受け付ける = 追加経費種別 AND 移動先経費種別ID AND 移動先費用区分 AND 削除依頼者ユーザーID -> 経費種別削除リクエスト

behavior 経費種別削除リマップを依頼する = 経費種別削除リクエスト -> 経費種別削除リクエスト AND 経費種別削除リマップ依頼イベント
// 事後: 経費精算（取引の経費種別移動）／自動分類・学習（学習データのリマップ）に依頼を発火

behavior 経費種別削除リマップ完了を受け取る = 経費種別削除リクエスト AND 経費精算完了通知 AND 自動分類学習完了通知 -> 経費種別削除リクエスト AND 経費種別削除完了イベント
// 注: カテゴリ側と同様、本 behavior は両通知が揃った時点の概念上の最終遷移（上記参照）

data 経費精算完了通知 = 経費種別削除リクエストID AND 影響取引数 AND 完了日時

// --- 月次上限の操作 ---

behavior 月次上限をseed投入する = ユーザーID AND 経費種別ID AND seed上限 AND 投入日時 -> 月次上限 AND 月次上限seed投入イベント
// 事前: 役割（夫/妻）が判定済みで個人別 seed 値が決まっている（論点14）
// 事後: 上限あり または 無制限のいずれかとして投入

data seed上限 = 上限あり初期値 OR 無制限初期値
data 上限あり初期値 = 上限金額
data 無制限初期値 = なし

behavior 月次上限を変更する = 月次上限 AND 新上限 AND 変更者ユーザーID -> 月次上限 AND 月次上限変更イベント
// 事前: 変更者ユーザーID = 月次上限の所有者ユーザーID
// 事後: 経費精算へ変更を通知し、当月の按分が再計算される
// 事後: 案件等の一時増減も同経路で対応する（OQ-19）

data 新上限 = 上限あり初期値 OR 無制限初期値

behavior 追加経費種別の月次上限を新規設定する = 追加経費種別 AND ユーザーID AND seed上限 -> 月次上限 AND 月次上限新規設定イベント
// 事前: 追加経費種別が新設された
// 事後: 上限あり／なしを選択可能

// --- Phase 0 設定値の投入 ---

behavior LINE Channel設定を投入する = Channel_ID AND Channel_Secret AND Channel_Access_Token AND 投入日時 -> LINE_Channel設定 AND LINE_Channel設定投入イベント
// 事前: LINE 公式アカウントが作成済み
// 事後: Parameter Store（KMS）に保存

data Channel_ID = 文字列
data Channel_Secret = 文字列
data Channel_Access_Token = 文字列

behavior LINE Webhook エンドポイントを設定する = Webhook_URL AND バックエンド_Lambda_紐付け参照 -> LINE_Webhook設定 AND LINE_Webhook設定イベント

behavior 許可リストを投入する = 夫LINE_userID AND 妻LINE_userID AND 投入日時 -> 許可リスト設定 AND 許可リスト投入イベント
// 事後: Parameter Store に保存し、オンボーディング・認証が役割判定で参照する

behavior LINE公式アカウントを作成する = LINE公式アカウント識別 AND 作成日時 -> LINE公式アカウント作成イベント

// --- 設定値の参照（読出 API） ---

behavior 許可リストを参照する = ユーザーID -> 許可リスト
// 事前: オンボーディング・認証から役割判定の事前条件として呼出
// 事後: Parameter Store から復号して返却

behavior LINE Channel設定値を参照する = ユーザーID -> LINE_Channel設定
// 事前: 通知配信から push API 呼出の事前条件として呼出
```

## 3. ドメインイベント

```
data カテゴリseed投入イベント = カテゴリID AND 規定カテゴリ種別 AND 投入日時 AND 発生日時
data カテゴリ追加イベント = カテゴリID AND カテゴリ名 AND 作成者ユーザーID AND 発生日時
data カテゴリ改名イベント = カテゴリID AND 旧カテゴリ名 AND 新カテゴリ名 AND 改名者ユーザーID AND 発生日時
data カテゴリ削除リマップ依頼イベント = カテゴリ削除リクエストID AND 削除対象カテゴリID AND 移動先カテゴリID AND 移動先費用区分 AND 発生日時
data カテゴリ削除完了イベント = カテゴリ削除リクエストID AND 影響取引数 AND 影響学習ルール数 AND 発生日時
data 経費種別seed投入イベント = 経費種別ID AND 規定経費種別種別 AND 投入日時 AND 発生日時
data 経費種別追加イベント = 経費種別ID AND 経費種別名 AND 作成者ユーザーID AND 発生日時
data 経費種別改名イベント = 経費種別ID AND 旧経費種別名 AND 新経費種別名 AND 改名者ユーザーID AND 発生日時
data 経費種別削除リマップ依頼イベント = 経費種別削除リクエストID AND 削除対象経費種別ID AND 移動先経費種別ID AND 移動先費用区分 AND 発生日時
data 経費種別削除完了イベント = 経費種別削除リクエストID AND 影響取引数 AND 影響学習ルール数 AND 発生日時
data 月次上限seed投入イベント = 月次上限ID AND ユーザーID AND 経費種別ID AND seed上限 AND 発生日時
data 月次上限変更イベント = 月次上限ID AND 旧上限 AND 新上限 AND 変更者ユーザーID AND 発生日時
data 月次上限新規設定イベント = 月次上限ID AND ユーザーID AND 経費種別ID AND seed上限 AND 発生日時
data LINE_Channel設定投入イベント = Phase0設定値ID AND 投入日時 AND 発生日時
data LINE_Webhook設定イベント = Phase0設定値ID AND 設定日時 AND 発生日時
data 許可リスト投入イベント = Phase0設定値ID AND 投入日時 AND 発生日時
data LINE公式アカウント作成イベント = LINE公式アカウント識別 AND 作成日時 AND 発生日時

data 旧上限 = 上限あり初期値 OR 無制限初期値
data Phase0設定値ID = 文字列
```

## 4. 隣接コンテキストとの境界

| 隣接 | 関係 | 翻訳層 behavior |
|---|---|---|
| AWS Parameter Store（外部システム） | Conformist（順応者） | `behavior LINE Channel設定を投入する`／`behavior 許可リストを投入する`（Parameter Store の API に従う） |
| 自動分類・学習 | 顧客-供給者（下流: カテゴリ／経費種別 ID を供給／削除リマップ要請を発火） | `behavior カテゴリ削除リマップを依頼する`／`behavior 経費種別削除リマップを依頼する`（要請発火）／`behavior カテゴリ削除リマップ完了を受け取る`（完了通知の受付） |
| 家計分析 | 顧客-供給者（下流: カテゴリマスタを供給／削除リマップ要請を発火） | `behavior カテゴリ削除リマップを依頼する`／`behavior カテゴリ削除リマップ完了を受け取る` |
| 経費精算 | 顧客-供給者（下流: 経費種別マスタ・月次上限を供給／削除リマップ要請を発火） | `behavior 経費種別削除リマップを依頼する`／`behavior 月次上限を変更する` の出力イベントが経費精算を起動 |
| オンボーディング・認証 | 顧客-供給者（下流: Phase 2-C/D/E のマスタ確認 UI を供給／許可リスト参照を提供） | `behavior 許可リストを参照する`／`behavior 月次上限をseed投入する`（Phase 1 役割確定時の自動紐付け） |
| 通知配信 | 顧客-供給者（下流: LINE Channel 設定値を供給） | `behavior LINE Channel設定値を参照する` |
