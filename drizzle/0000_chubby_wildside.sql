CREATE TYPE "public"."classification" AS ENUM('PUBLIC', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('FIR', 'POLICE_REPORT', 'INVESTIGATION_RECORD', 'WITNESS_STATEMENT', 'CHARGE_SHEET', 'COURT_FILING', 'EVIDENCE_RECORD', 'FORENSIC_REPORT', 'LEGAL_NOTICE', 'JUDGMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."integrity_status" AS ENUM('VERIFIED', 'TAMPERED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('SCANNING', 'OCR', 'INDEXING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" char(64) NOT NULL,
	"note" text,
	"restored_from_version_id" uuid,
	"processing_status" "processing_status" DEFAULT 'SCANNING' NOT NULL,
	"integrity_status" "integrity_status" DEFAULT 'PENDING' NOT NULL,
	"ledger_tx_id" text,
	"integrity_checked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_document_id_version_no_key" UNIQUE("document_id","version_no"),
	CONSTRAINT "document_versions_size_bytes_check" CHECK ("document_versions"."size_bytes" >= 0),
	CONSTRAINT "document_versions_sha256_check" CHECK ("document_versions"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"title" text NOT NULL,
	"doc_type" "doc_type" NOT NULL,
	"classification" "classification" NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"current_version_id" uuid,
	"sealed" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_restored_from_fkey" FOREIGN KEY ("restored_from_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_versions_document_id_idx" ON "document_versions" USING btree ("document_id","version_no");--> statement-breakpoint
CREATE INDEX "document_versions_created_by_idx" ON "document_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "document_versions_pending_idx" ON "document_versions" USING btree ("processing_status") WHERE "document_versions"."processing_status" <> 'READY' and "document_versions"."processing_status" <> 'FAILED';--> statement-breakpoint
CREATE INDEX "documents_case_id_idx" ON "documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "documents_doc_type_idx" ON "documents" USING btree ("doc_type");--> statement-breakpoint
CREATE INDEX "documents_classification_idx" ON "documents" USING btree ("classification");--> statement-breakpoint
CREATE INDEX "documents_created_by_idx" ON "documents" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "documents_active_idx" ON "documents" USING btree ("case_id") WHERE "documents"."deleted_at" is null;