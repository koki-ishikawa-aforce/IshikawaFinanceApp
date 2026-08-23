CREATE TABLE "balance_history_entries" (
	"entry_id" text PRIMARY KEY NOT NULL,
	"axis" text NOT NULL,
	"account_id" text NOT NULL,
	"balance" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_history_entries_axis_source_event_id_unique" UNIQUE("axis","source_event_id"),
	CONSTRAINT "balance_history_entries_axis_check" CHECK ("balance_history_entries"."axis" IN ('smbc_balance', 'other_savings_balance', 'nisa_contribution', 'card_unpaid'))
);
--> statement-breakpoint
ALTER TABLE "balance_history_entries" ADD CONSTRAINT "balance_history_entries_account_id_accounts_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_balance_history_entries_axis_occurred_at" ON "balance_history_entries" USING btree ("axis","occurred_at");