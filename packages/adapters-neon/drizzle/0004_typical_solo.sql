CREATE TABLE "monthly_expense_cycles" (
	"monthly_expense_cycle_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"target_year_month" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_expense_cycles_user_month_unique" UNIQUE("user_id","target_year_month"),
	CONSTRAINT "monthly_expense_cycles_target_year_month_check" CHECK ("monthly_expense_cycles"."target_year_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "monthly_expense_cycles_kind_check" CHECK ("monthly_expense_cycles"."kind" IN ('accumulating', 'csv_confirmed', 'finalized'))
);
--> statement-breakpoint
CREATE TABLE "prorated_child_transactions" (
	"child_transaction_id" text PRIMARY KEY NOT NULL,
	"parent_transaction_id" text NOT NULL,
	"user_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_reimbursement_deposits" (
	"expense_reimbursement_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_reimbursement_deposits_kind_check" CHECK ("expense_reimbursement_deposits"."kind" IN ('awaiting_match', 'matched', 'unrecognized_confirmed'))
);
--> statement-breakpoint
CREATE INDEX "idx_prorated_children_parent" ON "prorated_child_transactions" USING btree ("parent_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_expense_deposits_awaiting" ON "expense_reimbursement_deposits" USING btree ("user_id") WHERE "expense_reimbursement_deposits"."kind" = 'awaiting_match';