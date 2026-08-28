CREATE TABLE "access_denial_counters" (
	"line_user_id" text PRIMARY KEY NOT NULL,
	"denied_count" integer NOT NULL,
	"last_denied_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
