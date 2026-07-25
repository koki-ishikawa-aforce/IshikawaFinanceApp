-- ファイル本体・meta スナップショット・_journal.json は
-- `pnpm --filter @warimaru/adapters-neon db:generate --custom` の生成物。
-- 本 Issue はテーブル定義（DDL）を変えないため生成される DDL は空で、以下は手書きのデータ移行
-- DML のみ（drizzle-kit は DDL しか生成できない。0008 と同じ形式）。
--
-- データ移行（#334 / OQ-55 ①）: per-user の通知機能有効化記録が持っていた共通トークルームID を
-- 除去する。トークルームID の正は世帯レベルの shared_talk_rooms 1 か所であり、有効化時点の ID を
-- per-user に複製したままにすると招待し直し（トークルーム作り直し）で古い ID が残る。
-- 有効化日時（activatedAt）は残すため、有効化済みという事実そのものは失われない。
--
-- payload の置き場所は運用開始済みが集約直下、それ以前が common 配下（AppUser の昇格規約）。
-- 存在しないパスへの #- は無変更のため、どの Phase 状態の payload にも安全に適用できる。
-- 同じ行への再適用も無変更（この移行は冪等）。
--
-- 適用順序（この移行は片方向のみ安全）: 先に本 Issue のコードをデプロイし、その後に本移行を
-- 適用する。逆順にすると、移行前のコードが持つ NotificationActivationState は talkRoomId を
-- 必須にしているため、有効化済みユーザーの行が AppUserSchema.parse を通らなくなり、
-- NeonAppUserRepository の findById / findByRole が投げてオンボーディング系 API が落ちる。
-- ローリング更新中も、新インスタンスが保存した talkRoomId 無しの行を旧インスタンスが読むと
-- 同じ失敗が起きるため、有効化操作が発生しない時間帯に切り替える。
-- 誤って先に適用した場合は shared_talk_rooms.talk_room_id から jsonb_set で書き戻せば復旧する
-- （消えるのは複製であり、正は shared_talk_rooms に残っている）。
UPDATE "app_users"
SET "payload" = ("payload" #- '{lineOperationSettings,notificationActivation,talkRoomId}')
	#- '{common,lineOperationSettings,notificationActivation,talkRoomId}';
