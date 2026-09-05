CREATE TABLE "case_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"case_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"details" jsonb,
	"prev_hash" char(64) NOT NULL,
	"entry_hash" char(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "case_activity_log_seq_key" UNIQUE("seq"),
	CONSTRAINT "case_activity_log_entry_hash_key" UNIQUE("entry_hash"),
	CONSTRAINT "case_activity_log_prev_hash_check" CHECK ("case_activity_log"."prev_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "case_activity_log_entry_hash_check" CHECK ("case_activity_log"."entry_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"document_id" uuid,
	"parent_comment_id" uuid,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mentions" text[] DEFAULT '{}'::text[] NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comments_body_not_empty_check" CHECK (length("comments"."body") > 0)
);
--> statement-breakpoint
CREATE INDEX "case_activity_log_case_id_idx" ON "case_activity_log" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "case_activity_log_actor_id_idx" ON "case_activity_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "case_activity_log_target_idx" ON "case_activity_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "comments_case_id_idx" ON "comments" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_document_id_idx" ON "comments" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_parent_comment_id_idx" ON "comments" USING btree ("parent_comment_id");--> statement-breakpoint
CREATE INDEX "comments_author_id_idx" ON "comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "comments_active_idx" ON "comments" USING btree ("case_id","created_at") WHERE "comments"."deleted_at" is null;