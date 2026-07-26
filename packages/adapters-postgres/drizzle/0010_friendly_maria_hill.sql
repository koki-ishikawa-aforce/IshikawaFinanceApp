CREATE TABLE "bank_deposits" (
	"bank_deposit_id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_deposits_transaction_id_unique" UNIQUE("transaction_id"),
	CONSTRAINT "bank_deposits_kind_check" CHECK ("bank_deposits"."kind" IN ('salary', 'expense_reimbursement', 'other_savings_return', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX "idx_bank_deposits_awaiting" ON "bank_deposits" USING btree ("user_id","occurred_at") WHERE "bank_deposits"."kind" = 'unknown';