CREATE TABLE "category_masters" (
	"category_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_masters_name_owner_unique" UNIQUE NULLS NOT DISTINCT("name","owner_user_id"),
	CONSTRAINT "category_masters_kind_check" CHECK ("category_masters"."kind" IN ('default', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "expense_type_masters" (
	"expense_type_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_type_masters_name_owner_unique" UNIQUE NULLS NOT DISTINCT("name","owner_user_id"),
	CONSTRAINT "expense_type_masters_kind_check" CHECK ("expense_type_masters"."kind" IN ('default', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "monthly_limits" (
	"monthly_limit_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expense_type_id" text NOT NULL,
	"kind" text NOT NULL,
	"cap_amount" integer,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_limits_user_expense_type_unique" UNIQUE("user_id","expense_type_id"),
	CONSTRAINT "monthly_limits_kind_check" CHECK ("monthly_limits"."kind" IN ('capped', 'unlimited')),
	CONSTRAINT "monthly_limits_unlimited_cap_check" CHECK (("monthly_limits"."kind" = 'unlimited') = ("monthly_limits"."cap_amount" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "phase0_configs" (
	"phase0_config_id" text PRIMARY KEY NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phase0_configs_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "phase0_configs_singleton_check" CHECK ("phase0_configs"."singleton")
);
