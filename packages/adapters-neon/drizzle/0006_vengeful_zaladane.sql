CREATE TABLE "delivery_messages" (
	"delivery_message_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"purpose" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_messages_kind_check" CHECK ("delivery_messages"."kind" IN ('reserved', 'sending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "delivery_messages_purpose_check" CHECK ("delivery_messages"."purpose" IN ('csv_import_reminder', 'monthly_report_household_summary', 'monthly_report_personal_summary', 'oauth_revocation_notice', 'test_message'))
);
--> statement-breakpoint
CREATE TABLE "line_delivery_logs" (
	"delivery_log_id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"timing_kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_delivery_logs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "line_delivery_logs_timing_kind_check" CHECK ("line_delivery_logs"."timing_kind" IN ('reminder', 'csv_confirmation', 'oauth_revocation_detected', 'test_send'))
);
--> statement-breakpoint
CREATE TABLE "failsafe_emails" (
	"failsafe_email_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "failsafe_emails_kind_check" CHECK ("failsafe_emails"."kind" IN ('reserved', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "consecutive_failure_counters" (
	"ref_kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consecutive_failure_counters_ref_kind_ref_id_pk" PRIMARY KEY("ref_kind","ref_id"),
	CONSTRAINT "consecutive_failure_counters_ref_kind_check" CHECK ("consecutive_failure_counters"."ref_kind" IN ('user', 'talk_room'))
);
