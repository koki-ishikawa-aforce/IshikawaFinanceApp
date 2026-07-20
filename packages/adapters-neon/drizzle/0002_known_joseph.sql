CREATE TABLE "app_users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_role_unique" UNIQUE("role"),
	CONSTRAINT "app_users_role_check" CHECK ("app_users"."role" IN ('honey', 'darling')),
	CONSTRAINT "app_users_kind_check" CHECK ("app_users"."kind" IN ('phase1_completed', 'phase2_in_progress', 'phase2_completed', 'operation_started'))
);
--> statement-breakpoint
CREATE TABLE "gmail_oauth_tokens" (
	"user_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gmail_oauth_tokens_kind_check" CHECK ("gmail_oauth_tokens"."kind" IN ('valid', 'revocation_detected'))
);
