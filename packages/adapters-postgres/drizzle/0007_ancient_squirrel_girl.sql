CREATE TABLE "category_deletion_requests" (
	"category_deletion_request_id" text PRIMARY KEY NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"target_category_id" text NOT NULL,
	"state_kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_deletion_requests_state_kind_check" CHECK ("category_deletion_requests"."state_kind" IN ('pending_remap', 'remap_requested', 'remap_completed', 'remap_failed'))
);
--> statement-breakpoint
CREATE TABLE "expense_type_deletion_requests" (
	"expense_type_deletion_request_id" text PRIMARY KEY NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"target_expense_type_id" text NOT NULL,
	"state_kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_type_deletion_requests_state_kind_check" CHECK ("expense_type_deletion_requests"."state_kind" IN ('pending_remap', 'remap_requested', 'remap_completed', 'remap_failed'))
);
--> statement-breakpoint
ALTER TABLE "transaction_candidates" DROP CONSTRAINT "transaction_candidates_kind_check";--> statement-breakpoint
CREATE INDEX "idx_category_deletion_requests_target" ON "category_deletion_requests" USING btree ("target_category_id");--> statement-breakpoint
CREATE INDEX "idx_expense_type_deletion_requests_target" ON "expense_type_deletion_requests" USING btree ("target_expense_type_id");--> statement-breakpoint
ALTER TABLE "transaction_candidates" ADD CONSTRAINT "transaction_candidates_kind_check" CHECK ("transaction_candidates"."kind" IN ('normal', 'amazon_matched', 'match_timeout', 'confirmed'));