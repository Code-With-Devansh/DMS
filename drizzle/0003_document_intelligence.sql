-- Custom migration (not drizzle-generated): the document-intelligence pipeline.
-- Adds the per-stage / terminal states the async worker
-- (src/jobs/documentProcessing.processor.js) drives, plus the two result tables
-- it writes — document_extractions (text + ClamAV verdict + tag provenance) and
-- document_entities (normalized NER output, DESIGN §10's `entities` table).
--
-- document_versions is deliberately NOT touched: it is immutable/append-only
-- (0002_version_control.sql) and the pipeline rewrites its row many times per
-- job, so that state lives in document_extractions instead.

-- ── 1. processing_status: new pipeline + terminal states ─────────────────────
-- SCANNING -> EXTRACTING -> INDEXING (NER) -> TAGGING -> READY
-- terminal off-ramps: QUARANTINED (ClamAV / disallowed type), FAILED (error).
ALTER TYPE "public"."processing_status" ADD VALUE IF NOT EXISTS 'EXTRACTING' BEFORE 'INDEXING';--> statement-breakpoint
ALTER TYPE "public"."processing_status" ADD VALUE IF NOT EXISTS 'TAGGING' AFTER 'INDEXING';--> statement-breakpoint
ALTER TYPE "public"."processing_status" ADD VALUE IF NOT EXISTS 'QUARANTINED' AFTER 'READY';--> statement-breakpoint

-- ── 2. document_extractions ─────────────────────────────────────────────────
CREATE TABLE "document_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "processing_status" DEFAULT 'SCANNING' NOT NULL,
	"extraction_method" text,
	"mime_type" text,
	"extracted_text" text,
	"text_chars" integer DEFAULT 0 NOT NULL,
	"page_count" integer,
	"ocr_confidence" numeric(5, 4),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scanned_clean" boolean DEFAULT false NOT NULL,
	"virus_signature" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_extractions_version_id_key" UNIQUE("version_id")
);
--> statement-breakpoint

-- ── 3. document_entities ────────────────────────────────────────────────────
CREATE TABLE "document_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text,
	"confidence" numeric(5, 4) DEFAULT '1' NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_entities" ADD CONSTRAINT "document_entities_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "document_extractions_document_id_idx" ON "document_extractions" USING btree ("document_id");--> statement-breakpoint
-- document_extractions_pending_idx is created in 0004: it needs QUARANTINED,
-- added above, and Postgres won't let a value added by this transaction be
-- used as an enum literal until that transaction commits.
CREATE INDEX "document_entities_version_id_idx" ON "document_entities" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "document_entities_document_id_type_idx" ON "document_entities" USING btree ("document_id","type");--> statement-breakpoint
CREATE INDEX "document_entities_type_value_idx" ON "document_entities" USING btree ("type","value");
