CREATE TABLE "shared_talk_rooms" (
	"talk_room_id" text PRIMARY KEY NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"join_webhook_received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_talk_rooms_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "shared_talk_rooms_singleton_check" CHECK ("shared_talk_rooms"."singleton")
);
--> statement-breakpoint
-- データ移行（OQ-55 ①）: per-user の LINE_運用設定が持っていた共通トークルーム参加状態を
-- 世帯レベルの shared_talk_rooms へ移す。参加は世帯にひとつの事実のため、両者の記録のうち
-- join Webhook 受信が最も新しいものを採用する（招待し直しがあれば新しい方が現行ルーム）。
-- payload の置き場所は運用開始済みが集約直下、それ以前が common 配下（AppUser の昇格規約）。
WITH "joined_rooms" AS (
	SELECT COALESCE(
		("payload"->'lineOperationSettings')->'talkRoomJoin',
		(("payload"->'common')->'lineOperationSettings')->'talkRoomJoin'
	) AS "talk_room_join"
	FROM "app_users"
)
INSERT INTO "shared_talk_rooms" ("talk_room_id", "singleton", "join_webhook_received_at")
SELECT
	"talk_room_join"->>'talkRoomId',
	true,
	("talk_room_join"->>'joinWebhookReceivedAt')::timestamptz
FROM "joined_rooms"
WHERE "talk_room_join"->>'kind' = 'joined'
ORDER BY ("talk_room_join"->>'joinWebhookReceivedAt')::timestamptz DESC
LIMIT 1;--> statement-breakpoint
-- 移行元の per-user 記録を除去し、置き場所を世帯レベル 1 か所に一本化する（二重管理の防止）。
-- 存在しないパスへの #- は無変更のため、どの Phase 状態の payload にも安全に適用できる。
UPDATE "app_users"
SET "payload" = ("payload" #- '{lineOperationSettings,talkRoomJoin}') #- '{common,lineOperationSettings,talkRoomJoin}';
