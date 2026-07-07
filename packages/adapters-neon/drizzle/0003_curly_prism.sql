CREATE TABLE "merchant_learning_rules" (
	"user_id" text NOT NULL,
	"merchant_name" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_learning_rules_user_id_merchant_name_pk" PRIMARY KEY("user_id","merchant_name"),
	CONSTRAINT "merchant_learning_rules_kind_check" CHECK ("merchant_learning_rules"."kind" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "amazon_product_key_learning_rules" (
	"user_id" text NOT NULL,
	"amazon_product_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amazon_product_key_learning_rules_user_id_amazon_product_key_pk" PRIMARY KEY("user_id","amazon_product_key")
);
--> statement-breakpoint
CREATE TABLE "bulk_classification_sessions" (
	"bulk_classification_session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bulk_classification_sessions_kind_check" CHECK ("bulk_classification_sessions"."kind" IN ('in_progress', 'completed', 'aborted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bulk_sessions_in_progress" ON "bulk_classification_sessions" USING btree ("user_id") WHERE "bulk_classification_sessions"."kind" = 'in_progress';