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
UPDATE "app_users"
SET "payload" = ("payload" #- '{lineOperationSettings,notificationActivation,talkRoomId}')
	#- '{common,lineOperationSettings,notificationActivation,talkRoomId}';
