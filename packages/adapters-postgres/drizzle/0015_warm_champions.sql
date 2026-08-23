CREATE TABLE "household_notification_activations" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_notification_activations_singleton_check" CHECK ("household_notification_activations"."singleton")
);
