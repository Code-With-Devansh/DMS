CREATE TYPE "public"."ledger_status" AS ENUM('PENDING_LEDGER', 'ANCHORED', 'FAILED');--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "ledger_status" "ledger_status" DEFAULT 'PENDING_LEDGER' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "anchored_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "document_versions_ledger_pending_idx" ON "document_versions" USING btree ("ledger_status") WHERE "document_versions"."ledger_status" <> 'ANCHORED';