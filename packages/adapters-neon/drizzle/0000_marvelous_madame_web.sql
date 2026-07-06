CREATE TABLE "transactions" (
	"transaction_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"merchant_name" text NOT NULL,
	"amount" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category_id" text,
	"expense_class" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_kind_check" CHECK ("transactions"."kind" IN ('unclassified', 'classified', 'deleted')),
	CONSTRAINT "transactions_expense_class_check" CHECK ("transactions"."expense_class" IN ('household', 'personal_honey', 'personal_darling', 'business_expense')),
	CONSTRAINT "transactions_promoted_pair_check" CHECK (num_nonnulls("transactions"."category_id", "transactions"."expense_class") IN (0, 2)),
	CONSTRAINT "transactions_classified_pair_check" CHECK (("transactions"."kind" = 'classified') = (num_nonnulls("transactions"."category_id", "transactions"."expense_class") = 2))
);
--> statement-breakpoint
CREATE TABLE "monthly_reports" (
	"monthly_report_id" text PRIMARY KEY NOT NULL,
	"target_year_month" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_reports_target_year_month_unique" UNIQUE("target_year_month"),
	CONSTRAINT "monthly_reports_target_year_month_check" CHECK ("monthly_reports"."target_year_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "monthly_reports_kind_check" CHECK ("monthly_reports"."kind" IN ('csv_confirmed', 'finalized'))
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"account_id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"kind" text NOT NULL,
	"is_active" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_owner_user_id_kind_unique" UNIQUE("owner_user_id","kind"),
	CONSTRAINT "accounts_kind_check" CHECK ("accounts"."kind" IN ('smbc_bank', 'mitsui_sumitomo_card', 'other_savings', 'nisa'))
);
--> statement-breakpoint
CREATE TABLE "mitsui_sumitomo_unpaids" (
	"unpaid_aggregate_id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"current_month_unpaid_total" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mitsui_sumitomo_unpaids_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
ALTER TABLE "mitsui_sumitomo_unpaids" ADD CONSTRAINT "mitsui_sumitomo_unpaids_account_id_accounts_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_transactions_owner_occurred" ON "transactions" USING btree ("owner_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_transactions_unclassified" ON "transactions" USING btree ("owner_user_id","occurred_at") WHERE "transactions"."kind" = 'unclassified';