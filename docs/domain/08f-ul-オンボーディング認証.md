# ユビキタス言語: オンボーディング・認証

> 親: [docs/domain/08-ubiquitous-language.md](./08-ubiquitous-language.md)
> サブドメイン: Supporting（07-bounded-contexts.md §2.2）
> Phase 3.5 反映: 役割を Honey/Darling 表記に変更、ユーザー集約に nickname 属性を追加（[2026-05-01-phase3.5-ux-ui-design.md §3, §14.1](../superpowers/specs/2026-05-01-phase3.5-ux-ui-design.md)）
> 改訂（2026-07-24・判断セッション / #112④）: ニックネーム変更イベントの定義から「変更日時」を削除し、発生日時（occurredAt）に一本化。同期イベントで両者は常に同値のため冗長であり、専用日時を持たない他イベント（SectionFCompleted / RoleJudged 等）と整合させる。
> 改訂（2026-07-24・判断セッション / #73、OQ-55）: 共通トークルーム参加状態を per-user の LINE_運用設定 から**世帯レベルの置き場**へ分離（§1「LINE 運用設定」参照）。join Webhook が userId を含まず、参加は世帯にひとつの事実のため。あわせて Phase 1 の自己申告 API（line-friend / talk-room）は廃止し、follow / join Webhook を唯一の正とする（登録前 follow の取りこぼしは登録完了時の LINE 友だち状態照会でカバー）。
> 改訂（2026-07-25・判断セッション / #334、OQ-55 ①）: `data 有効化済み` から**共通トークルームID を削除**し、`有効化日時` のみとした（§1「通知機能有効化状態」参照）。トークルームID の正は世帯レベルの `共通トークルーム` 1 か所であり、有効化時点の ID を per-user に複製すると招待し直し（トークルーム作り直し）で古い ID が残り、二重保持のまま誰も検知できないため。`data 通知機能有効化イベント` の共通トークルームID は配信先として引き続き持つが、発行側は世帯レベルの記録から取得する。

## 責務

LIFF 初期化／LINE Login／LINE userID と許可リスト（Honey／Darling）の役割判定／ニックネーム管理／Gmail OAuth 連携と再認可／初期残高登録呼出／配偶者完了検知／LINE 友達追加・グループ招待・運用開始発火を一貫した利用者ライフサイクルとして担う。Phase 0 セットアップ（システム管理者視点）はマスタ管理に帰属する一方、Phase 1〜4（ユーザー視点）と運用中の認証維持は本コンテキストの責務（§1.1.5 確定）。

> **ロール表記について**: Phase 3.5 で役割名を `夫役割 / 妻役割` から `Honey / Darling` に変更した。Honey = 夫役、Darling = 妻役を指す（01-overview の「夫」「妻」と内部的には同義）。01-overview など Phase 1〜2 のドキュメントの「夫」「妻」表記は歴史的経緯で残置するが、本コンテキストおよび UI/UX レイヤでは Honey/Darling を正とする。

## 1. データ（data）

```
// 本コンテキストの中核は「アプリユーザー」（集約）と「Phase 進捗」「Gmail OAuth トークン」「LINE 関連 ID」の関連集約。
// 状態は OR で表現し、Phase ごとの遷移を明示する。

// クロスコンテキスト参照（ID のみ借用）
// referenced from: マスタ管理
data 許可リスト = HoneyLINE_userID AND DarlingLINE_userID  // Parameter Store の HUSBAND_LINE_USER_ID / WIFE_LINE_USER_ID（Phase 3.5 で Honey/Darling 表記に変更、Parameter Store キー名は互換維持）
data HoneyLINE_userID = LINE_userID
data DarlingLINE_userID = LINE_userID
// referenced from: 残高・資産推移管理（初期残高登録の入力先）
// referenced from: 取引取込（Gmail OAuth トークン参照・運用開始日時の借用先）
// referenced from: 通知配信（共通トークルームID・LINE userID の借用先）

// 共通語彙の借用
data 共通トークルームID = 文字列
data 発生日時 = 日時

// --- LINE userID と役割 ---

data LINE_userID = 文字列
data 役割 = Honey OR Darling  // Phase 3.5: 夫役割 → Honey、妻役割 → Darling に表記変更

data 役割判定結果 = 役割確定 OR 役割拒否

data 役割確定 = LINE_userID AND 役割 AND 判定日時
data 役割拒否 = LINE_userID AND 拒否日時 AND 拒否理由
data 拒否理由 = 許可リスト不一致

// --- アプリユーザー: 集約ルート ---
// アプリユーザーのライフサイクル: 未登録 → Phase 1 完了 → Phase 2 進行中 → Phase 2 完了 → 運用開始済み

// aggregate root
data アプリユーザー = Phase1完了ユーザー OR Phase2進行中ユーザー OR Phase2完了ユーザー OR 運用開始済みユーザー

data アプリユーザー共通属性 = ユーザーID
   AND LINE_userID
   AND 役割
   AND ニックネーム?
   AND 初回登録日時

data ユーザーID = 文字列  // = LINE_userID（OQ-15 によりエイリアス）
data ニックネーム = 文字列  // Phase 3.5 追加: 任意・10 文字以内目安・空ならロール名（Honey/Darling）を表示
// 編集はオンボーディング Phase 1 で初期入力 + 設定画面でいつでも変更可
// 表示は per-user ではなく世帯共通（妻が変更したら夫の画面でも反映）

data Phase1完了ユーザー = アプリユーザー共通属性

data Phase2進行中ユーザー = アプリユーザー共通属性 AND Phase2進捗

data Phase2完了ユーザー = アプリユーザー共通属性 AND Phase2完了日時 AND Gmail_OAuth_トークン参照 AND 初期残高登録参照

data 運用開始済みユーザー = アプリユーザー共通属性
   AND Phase2完了日時
   AND Gmail_OAuth_トークン参照
   AND 初期残高登録参照
   AND 運用開始日時
   AND LINE_運用設定

data 初期残高登録参照 = SMBC初期残高ID AND 別銀行貯蓄初期残高ID AND NISA初期累計ID
// 実体は残高・資産推移管理側にある。本コンテキストはユーザーID で参照のみ

data Gmail_OAuth_トークン参照 = ユーザーID AND トークン保管参照ID
data トークン保管参照ID = Parameter_Store_path  // 実値は Parameter Store（KMS）に保存
data Parameter_Store_path = 文字列

// --- Phase 2 進捗（順序強制 + 任意セクション） ---
// 論点8: A/B のみ必須・順序強制。C/D/E は任意（seed 投入で確認のみ）。F は推奨だがスキップ可。

data Phase2進捗 = SectionA進捗 AND SectionB進捗 AND SectionC進捗 AND SectionD進捗 AND SectionE進捗 AND SectionF進捗

data SectionA進捗 = SectionA未着手 OR SectionA完了
data SectionB進捗 = SectionB未着手 OR SectionB完了
data SectionC進捗 = SectionC未確認 OR SectionC確認済み OR SectionC編集済み
data SectionD進捗 = SectionD未確認 OR SectionD確認済み OR SectionD編集済み
data SectionE進捗 = SectionE未確認 OR SectionE確認済み OR SectionE変更済み
data SectionF進捗 = SectionF未着手 OR SectionFスキップ OR SectionF完了

data SectionA完了 = Gmail_OAuth_トークン参照 AND 完了日時
data SectionB完了 = 初期残高登録参照 AND 完了日時
data SectionC確認済み = 確認日時
data SectionC編集済み = 編集日時 AND 編集件数
data SectionD確認済み = 確認日時
data SectionD編集済み = 編集日時 AND 編集件数
data SectionE確認済み = 確認日時
data SectionE変更済み = 変更日時 AND 変更件数
data SectionFスキップ = スキップ日時
data SectionF完了 = 取込ジョブID AND 完了日時

data SectionA未着手 = なし
data SectionB未着手 = なし
data SectionC未確認 = なし
data SectionD未確認 = なし
data SectionE未確認 = なし
data SectionF未着手 = なし

// --- Gmail OAuth トークンのライフサイクル ---

data Gmail_OAuth_トークン = 有効トークン OR 失効検知済みトークン

data 有効トークン = ユーザーID AND トークン保管参照ID AND 認可日時 AND 最終確認日時

data 失効検知済みトークン = ユーザーID AND トークン保管参照ID AND 認可日時 AND 失効検知日時 AND 失効理由
data 失効理由 = API呼出失敗起因 OR 期限切れ起因

// --- LINE 運用設定（Phase 4） ---

data LINE_運用設定 = LINE_友達追加状態 AND 通知機能有効化状態
// 実装ノート（#41）: 友達追加・通知有効化は運用開始前
// （follow Webhook 等）から発生するため、
// 実装ではアプリユーザー共通属性に optional で事前蓄積し、運用開始発火時に
// 運用開始済みユーザー の属性へ昇格する（昇格後は共通属性から除去し、置き場所を一本化）。
// 改訂（2026-07-24・判断セッション / #73、OQ-55）: 共通トークルーム参加状態は per-user の
// LINE_運用設定 から分離し、世帯レベルの置き場（下記）で一本化した。

data LINE_友達追加状態 = 未追加 OR 友達追加済み
data 友達追加済み = ユーザーID AND follow_Webhook受信日時
// 日時の出自は follow Webhook の受信に限らない。登録時の 友達状態照会（下記 §2）で確認した
// 場合はその確認時刻が入る。名称は既存の保存項目名との互換のため据え置いている（#297）

data 通知機能有効化状態 = 未有効化 OR 有効化済み
data 有効化済み = 有効化日時
// 改訂（2026-07-25・判断セッション / #334）: 共通トークルームID を持たない。配信先は都度
// 世帯レベルの 共通トークルーム を参照する（per-user への複製は招待し直しで陳腐化するため）

// --- 共通トークルーム: 集約ルート（世帯レベル） ---
// アプリユーザー集約の外に置く。参加は世帯にひとつの事実であり、join Webhook は userID を含まない

// aggregate root
data 共通トークルーム = 共通トークルーム参加状態

data 共通トークルーム参加状態 = 未参加 OR 参加済み
data 参加済み = 共通トークルームID AND join_Webhook受信日時
// 通知配信（DeliveryTarget.shared_talk_room）・通知機能有効化が参照する「正」はこの世帯レベルの記録

data 未追加 = なし
data 未参加 = なし
data 未有効化 = なし

// --- 配偶者完了検知 ---
data 配偶者完了検知結果 = 配偶者待ち OR 両者完了済み

data 配偶者待ち = ユーザーID AND 配偶者ユーザーID AND 検知日時
data 両者完了済み = HoneyユーザーID AND DarlingユーザーID AND 両者完了日時

// --- セッション・サインイン ---
data サインインセッション = ユーザーID AND サインイン日時 AND セッション有効期限
```

## 2. 振る舞い（behavior）

```
// --- ACL 翻訳層: LINE Login → 内部表現 ---

behavior LIFFを初期化する = LIFF_URL -> LIFF初期化結果
data LIFF_URL = 文字列
data LIFF初期化結果 = 初期化成功 OR 初期化失敗
data 初期化成功 = LIFF_セッション_ID AND 初期化日時
data 初期化失敗 = 失敗詳細 AND 検知日時
data LIFF_セッション_ID = 文字列
data 失敗詳細 = 文字列
// 事後: 失敗時は LIFF SDK 任せ（論点6）、独自リトライ UI なし

behavior LINE_userIDを取得する = 初期化成功 -> LINE_userID OR 取得失敗
data 取得失敗 = 失敗詳細 AND 検知日時

behavior 役割を判定する = LINE_userID AND 許可リスト -> 役割判定結果 AND 役割判定イベント
// 事前: 許可リストはマスタ管理が Parameter Store から供給
// 事後: 一致しなければ 役割拒否、エラー画面で拒否

// --- アプリユーザーの登録 ---

behavior アプリユーザーを新規登録する = LINE_userID AND 役割 AND ニックネーム? -> Phase1完了ユーザー AND ユーザー新規登録イベント OR 重複登録エラー
// 事前: 役割判定結果 = 役割確定
// 事前: 同一 LINE_userID の既存ユーザーが存在しない
// 事後: ユーザーID = LINE_userID（OQ-15）
// 事後: ニックネーム未指定なら null（表示時にロール名 Honey/Darling にフォールバック）

data 重複登録エラー = LINE_userID AND 既存ユーザーID

behavior サインインする = LINE_userID -> サインインセッション OR 未登録ユーザーエラー
data 未登録ユーザーエラー = LINE_userID AND 検知日時

// --- ニックネーム管理（Phase 3.5 追加） ---

behavior ニックネームを変更する = ユーザーID AND 新ニックネーム? -> アプリユーザー AND ニックネーム変更イベント
// 事前: 操作者 = 本人（自分のニックネームのみ変更可、配偶者のは不可）
// 事後: 新ニックネーム = null なら表示はロール名（Honey/Darling）にフォールバック
// 事後: 配偶者のダッシュボード表示にも反映（世帯共通）
data ニックネーム変更イベント = ユーザーID AND 旧ニックネーム? AND 新ニックネーム? AND 発生日時
// 変更日時は持たない（発生日時 occurredAt に一本化。同期イベントで両者は常に同値のため）

// --- ACL 翻訳層: Gmail OAuth → 内部表現 ---

behavior Gmail OAuth認可を開始する = ユーザーID -> OAuth認可URL AND OAuth認可開始イベント
data OAuth認可URL = 文字列  // liff.openWindow({external: true}) で OS 標準ブラウザに切り出す（OQ-7）

behavior Gmail OAuth認可を完了する = ユーザーID AND 認可コード -> 有効トークン AND Gmail連携完了イベント OR OAuth認可エラー OR OAuthキャンセル
data OAuth認可エラー = ユーザーID AND エラー詳細 AND 検知日時
data OAuthキャンセル = ユーザーID AND キャンセル日時
// 事後: トークンは Parameter Store（KMS）に保存し、参照IDのみを内部 data として保持

behavior Gmail OAuth トークンの失効を検知する = ユーザーID AND API呼出失敗 -> 失効検知済みトークン AND Gmail_OAuth失効検知イベント
// 事前: 取引取込からの API 呼出失敗通知
// 事後: 通知配信に LINE 個人 DM での OAuth 失効通知を依頼

data API呼出失敗 = ユーザーID AND 失敗詳細 AND 検知日時

behavior Gmail OAuth を再認可する = 失効検知済みトークン AND 認可コード -> 有効トークン AND Gmail再認可完了イベント
// 事前: ユーザーがアプリの「Gmail 再認可」ボタンを押下
// 事後: 取引取込にメール取込再開を通知

// --- Phase 2 進捗管理 ---

behavior Phase2 を開始する = Phase1完了ユーザー -> Phase2進行中ユーザー AND Phase2開始イベント
// 事後: Phase2進捗 のすべてのセクションが未着手状態

behavior Phase2 SectionA を完了する = Phase2進行中ユーザー AND 有効トークン -> Phase2進行中ユーザー AND SectionA完了イベント
// 事前: Gmail OAuth が有効
// 事後: SectionB が未着手なら次の入力可能セクションは SectionB（順序強制）

behavior Phase2 SectionB を完了する = Phase2進行中ユーザー AND 初期残高登録参照 -> Phase2進行中ユーザー AND SectionB完了イベント
// 事前: SectionA 完了済み
// 事前: 残高・資産推移管理に 初期残高 が登録された
// 事後: SectionC/D/E は seed 確認のみ任意（論点8）

behavior Phase2 SectionC/D/E を確認する = Phase2進行中ユーザー -> Phase2進行中ユーザー AND SectionC/D/E確認イベント
// 事前: SectionB 完了済み
// 事後: 確認のみで完了扱い、編集も可能

behavior Phase2 SectionF を実行する = Phase2進行中ユーザー AND 取込ジョブID -> Phase2進行中ユーザー AND SectionF完了イベント
// 事後: 取引取込が初期 CSV/PDF 取込を実行する

behavior Phase2 SectionF をスキップする = Phase2進行中ユーザー -> Phase2進行中ユーザー AND SectionFスキップイベント

behavior Phase2 を完了する = Phase2進行中ユーザー -> Phase2完了ユーザー AND Phase2完了イベント
// 事前: SectionA 完了 AND SectionB 完了
// 事後: 配偶者の Phase2 完了状態を画面ロード時にチェックする（論点19）

// --- 配偶者完了検知（画面ロード時のみ判定、論点19） ---

behavior 配偶者完了を検知する = ユーザーID AND 画面ロード日時 -> 配偶者完了検知結果 AND 配偶者完了検知イベント?
// 事前: ユーザーが Phase2 を完了し、画面ロード（ポーリング・WebSocket は使わない）
// 事後: 両者完了済み なら運用開始発火を準備、配偶者待ち ならアプリ内バナーを表示

// --- 運用開始発火（自動・両者完了で） ---

behavior 運用開始を発火する = 両者完了済み -> 運用開始済みユーザー(Honey) AND 運用開始済みユーザー(Darling) AND 運用開始イベント
// 事前: 両者の Phase2 完了が揃った
// 事後: 取引取込に日次バッチ稼働対象化を通知（翌日 0:00 から、論点16）
// 事後: 家計分析に月次レポート画面解放を通知
// 事後: 通知配信にテスト送信を依頼（Phase 4 を起動）

data 運用開始済みユーザー(Honey) = 運用開始済みユーザー
data 運用開始済みユーザー(Darling) = 運用開始済みユーザー

// --- LINE 友達追加・共通トークルーム招待（Phase 4） ---

behavior follow Webhook を受信する = LINE_userID AND Webhook受信日時 -> 友達追加済み AND friend_added_イベント
// 事前: ユーザーが LINE 公式アカウントを友達追加した
// 事後: 宛先のアプリユーザーが未登録なら記録せず破棄する（OQ-55 ③。拾い直しは下の照会）

behavior LINE友達状態を照会する = LINE_userID -> 友達状態照会結果
data 友達状態照会結果 = 友達済み OR 友達未追加 OR 照会不能
data 友達済み = なし
data 友達未追加 = なし
data 照会不能 = 照会失敗詳細
data 照会失敗詳細 = 文字列
// 事前: アプリユーザーの登録要求を受けた（新規登録の成立直後、および登録済みの冪等な再要求時）
// 事前: LINE_友達追加状態 = 未追加（追加済みなら照会しない）
// 事後: 友達済み なら 友達追加済み を記録し friend_added_イベント を発行する（記録は冪等）
// 事後: 照会不能 は 友達未追加 と区別する（API 障害を根拠に未追加を確定させない）
// 事後: 照会・記録の失敗は登録を失敗させない。回復は次の登録要求での再照会に依る
//       — follow Webhook は友達追加（またはブロック解除）の瞬間にしか発生せず、登録前に
//       友達追加していたユーザーへ再送されないため、Webhook は回復経路にならない
// 登録前の友達追加は follow Webhook が破棄される（上記）ため、この照会が唯一の拾い直し経路
// （自己申告 API は廃止予定。OQ-55 ②③）

behavior join Webhook を受信する = 共通トークルームID AND トークルーム種別 AND Webhook受信日時 -> 参加済み AND join_イベント
// 事前: LINE 公式アカウントがトークルームに招待された
// 事前: 未参加である（参加済みなら上書きしない。参加先の変更は自己申告 API に残す）
// 事前: 在籍照会結果 = 在籍あり（#371 で A を選択。下の照会を通ってから記録する）
// 事後: 共通トークルームID を DB に保存し、通知配信が以後参照する
data トークルーム種別 = グループ OR 複数人トーク

behavior 共通トークルーム在籍を照会する = 共通トークルームID AND トークルーム種別 AND 世帯のLINE_userID -> 在籍照会結果
data 在籍照会結果 = 在籍あり OR 在籍なし OR 在籍照会不能
data 在籍あり = なし
data 在籍なし = なし
data 在籍照会不能 = 照会失敗詳細
// 事前: join Webhook を受信し、まだ参加記録が無い
// 事後: 世帯のいずれかのユーザーが在籍していれば 在籍あり（1 人でも在籍すれば足りる）
// 事後: 在籍照会不能 は 在籍なし と区別する（API 障害を根拠に「夫婦のトークルームではない」を確定させない）
// 事後: 在籍あり 以外では参加を記録しない。join は招待の瞬間にしか発生せず再送されないため、
//       見送った回の回復は招待のやり直しか自己申告 API による
// join の source は userID を含まず、公式アカウントを自分のグループへ招待できる第三者も
// 正規の join を発生させられる。共通トークルームは家計サマリの配信先そのものなので、
// 在籍を確かめずに記録すると世帯の金額が第三者に届く（#371、OQ-55 ①）

behavior 通知機能を有効化する = 運用開始済みユーザー(Honey) AND 運用開始済みユーザー(Darling) AND 共通トークルーム参加状態 -> 有効化済み AND 通知機能有効化イベント
// 事前: 両者ともに友達追加済み・世帯が共通トークルーム参加済み
// 事後: 通知配信にテストメッセージ送信を依頼
// 共通トークルーム参加状態は前提条件の検証にのみ使う。有効化済み は共通トークルームID を
// 保持せず、イベントへ載せる配信先は世帯レベルの 共通トークルーム から取る（#334）

// --- 横断ライフサイクル ---

behavior 権限のないアクセスを拒否する = LINE_userID AND 役割拒否 -> 拒否画面表示 AND アクセス拒否イベント
data 拒否画面表示 = 拒否日時 AND 表示メッセージ
```

## 3. ドメインイベント

```
data 役割判定イベント = LINE_userID AND 役割判定結果 AND 発生日時
data ユーザー新規登録イベント = ユーザーID AND 役割 AND 発生日時
data アクセス拒否イベント = LINE_userID AND 拒否理由 AND 発生日時
data Gmail連携完了イベント = ユーザーID AND 認可日時 AND 発生日時
data Gmail_OAuth失効検知イベント = ユーザーID AND 検知日時 AND 発生日時
data Gmail再認可完了イベント = ユーザーID AND 再認可日時 AND 発生日時
data OAuth認可開始イベント = ユーザーID AND 開始日時 AND 発生日時
data Phase2開始イベント = ユーザーID AND 開始日時 AND 発生日時
data SectionA完了イベント = ユーザーID AND 完了日時 AND 発生日時
data SectionB完了イベント = ユーザーID AND 完了日時 AND 発生日時
data SectionC/D/E確認イベント = ユーザーID AND セクション識別 AND 確認日時 AND 発生日時
data SectionF完了イベント = ユーザーID AND 取込ジョブID AND 発生日時
data SectionFスキップイベント = ユーザーID AND スキップ日時 AND 発生日時
data Phase2完了イベント = ユーザーID AND 完了日時 AND 発生日時
data 配偶者完了検知イベント = ユーザーID AND 配偶者ユーザーID AND 検知結果 AND 発生日時
data 運用開始イベント = HoneyユーザーID AND DarlingユーザーID AND 運用開始日時 AND 発生日時
data friend_added_イベント = ユーザーID AND 受信日時 AND 発生日時
data join_イベント = 共通トークルームID AND 受信日時 AND 発生日時
data 通知機能有効化イベント = 共通トークルームID AND 有効化日時 AND 発生日時
data セクション識別 = SectionC OR SectionD OR SectionE
data 検知結果 = 配偶者待ち OR 両者完了済み
```

## 4. 隣接コンテキストとの境界

| 隣接 | 関係 | 翻訳層 behavior |
|---|---|---|
| LINE Login（外部システム） | ACL（Anti-Corruption Layer） | `behavior LIFFを初期化する`／`behavior LINE_userIDを取得する` |
| Gmail OAuth（外部システム） | ACL（Anti-Corruption Layer） | `behavior Gmail OAuth認可を開始する`／`behavior Gmail OAuth認可を完了する`／`behavior Gmail OAuth トークンの失効を検知する`／`behavior Gmail OAuth を再認可する` |
| LINE Messaging API（外部、Webhook 受信／友達状態照会／共通トークルーム在籍照会） | ACL | `behavior follow Webhook を受信する`／`behavior join Webhook を受信する`／`behavior LINE友達状態を照会する`／`behavior 共通トークルーム在籍を照会する` |
| AWS Parameter Store（外部システム） | Conformist（順応者） | （Gmail OAuth トークン保管・許可リスト読出。実装は Parameter Store の API に従う） |
| マスタ管理 | 顧客-供給者（上流: 許可リスト・LINE Channel 設定値を供給） | `behavior 役割を判定する`（許可リスト参照） |
| 残高・資産推移管理 | 顧客-供給者（下流: 初期残高登録を依頼） | `behavior Phase2 SectionB を完了する` の事前条件として残高・資産推移管理の `behavior 初期残高を登録する` を呼出 |
| 取引取込 | 顧客-供給者（下流: Gmail OAuth トークン参照／運用開始日時／初期 CSV/PDF 取込起動を供給） | `behavior 運用開始を発火する`／`behavior Gmail OAuth を再認可する`（メール取込再開トリガー） |
| 通知配信 | 顧客-供給者（下流: テスト送信／OAuth 失効通知／LINE userID・共通トークルームID を供給） | `behavior 通知機能を有効化する`／`behavior Gmail OAuth トークンの失効を検知する` の出力イベント |
| 家計分析 | 顧客-供給者（下流: 月次レポート画面解放を依頼） | `behavior 運用開始を発火する` の出力イベントが家計分析を起動 |
