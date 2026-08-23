CREATE TABLE "employer_remitter_names" (
	"user_id" text NOT NULL,
	"normalized_name" text NOT NULL,
	"display_name" text NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	"source_transaction_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employer_remitter_names_user_id_normalized_name_pk" PRIMARY KEY("user_id","normalized_name")
);
