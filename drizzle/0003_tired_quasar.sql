CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"ip" text,
	"details" jsonb,
	"prev_hash" char(64) NOT NULL,
	"entry_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_log_seq_key" UNIQUE("seq"),
	CONSTRAINT "audit_log_entry_hash_key" UNIQUE("entry_hash"),
	CONSTRAINT "audit_log_prev_hash_check" CHECK ("audit_log"."prev_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "audit_log_entry_hash_check" CHECK ("audit_log"."entry_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");