CREATE TABLE "transaction_candidates" (
	"transaction_candidate_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"merchant_name" text NOT NULL,
	"amount" integer NOT NULL,
	"occurred_on" date NOT NULL,
	"gmail_message_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_candidates_kind_check" CHECK ("transaction_candidates"."kind" IN ('normal', 'amazon_matched', 'match_timeout'))
);
--> statement-breakpoint
CREATE TABLE "daily_mail_import_batches" (
	"import_batch_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_mail_import_batches_kind_check" CHECK ("daily_mail_import_batches"."kind" IN ('started', 'importing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "statement_import_jobs" (
	"import_job_id" text PRIMARY KEY NOT NULL,
	"uploader_user_id" text NOT NULL,
	"target_month" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statement_import_jobs_target_month_check" CHECK ("statement_import_jobs"."target_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "statement_import_jobs_kind_check" CHECK ("statement_import_jobs"."kind" IN ('upload_accepted', 'pdf_converting', 'format_validating', 'importing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_transaction_candidates_gmail_unique" ON "transaction_candidates" USING btree ("gmail_message_id") WHERE "transaction_candidates"."gmail_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_transaction_candidates_triple" ON "transaction_candidates" USING btree ("user_id","occurred_on","amount","merchant_name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mail_batches_in_progress" ON "daily_mail_import_batches" USING btree ("user_id") WHERE "daily_mail_import_batches"."kind" IN ('started', 'importing');--> statement-breakpoint
CREATE INDEX "idx_statement_import_jobs_user_month" ON "statement_import_jobs" USING btree ("uploader_user_id","target_month");