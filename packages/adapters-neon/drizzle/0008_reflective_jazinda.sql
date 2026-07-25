-- 1-9 行目の DDL は `pnpm --filter @warimaru/adapters-neon db:generate` の生成物（変更しない）。
-- 11 行目以降は手書きのデータ移行 DML。drizzle-kit は DDL しか生成できないため、
-- 既存データの移し替えはここに書く（スキーマとスナップショットの乖離は生じない）。
CREATE TABLE "shared_talk_rooms" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"talk_room_id" text NOT NULL,
	"join_webhook_received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_talk_rooms_singleton_check" CHECK ("shared_talk_rooms"."singleton")
);
--> statement-breakpoint
-- データ移行（OQ-55 ①）: per-user の LINE_運用設定が持っていた共通トークルーム参加状態を
-- 世帯レベルの shared_talk_rooms へ移す。参加は世帯にひとつの事実のため 1 行に集約する。
-- 現行ルームの選択は最新の受信日時（招待し直しがあれば新しい方が現行）、採用する受信日時は
-- そのルームの最古（recordSharedTalkRoomJoined の冪等規約 = 先着の受信日時を保持、に揃える）。
-- payload の置き場所は運用開始済みが集約直下、それ以前が common 配下（AppUser の昇格規約）。
WITH "joined_rooms" AS (
	SELECT COALESCE(
		("payload"->'lineOperationSettings')->'talkRoomJoin',
		(("payload"->'common')->'lineOperationSettings')->'talkRoomJoin'
	) AS "talk_room_join"
	FROM "app_users"
), "parsed" AS (
	SELECT
		"talk_room_join"->>'talkRoomId' AS "talk_room_id",
		("talk_room_join"->>'joinWebhookReceivedAt')::timestamptz AS "received_at"
	FROM "joined_rooms"
	WHERE "talk_room_join"->>'kind' = 'joined'
), "current_room" AS (
	SELECT "talk_room_id" FROM "parsed" ORDER BY "received_at" DESC LIMIT 1
)
INSERT INTO "shared_talk_rooms" ("singleton", "talk_room_id", "join_webhook_received_at")
SELECT true, "c"."talk_room_id", MIN("p"."received_at")
FROM "current_room" "c"
JOIN "parsed" "p" ON "p"."talk_room_id" = "c"."talk_room_id"
GROUP BY "c"."talk_room_id";--> statement-breakpoint
-- 移行元の per-user 記録を除去し、置き場所を世帯レベル 1 か所に一本化する（二重管理の防止）。
-- 存在しないパスへの #- は無変更のため、どの Phase 状態の payload にも安全に適用できる。
UPDATE "app_users"
SET "payload" = ("payload" #- '{lineOperationSettings,talkRoomJoin}') #- '{common,lineOperationSettings,talkRoomJoin}';
