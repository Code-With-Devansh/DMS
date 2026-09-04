CREATE TYPE "public"."approver_pool_role" AS ENUM('IN_POOL', 'CROSS_TIER_SECURITY_ADMIN', 'AUDITOR_VOTE', 'SYSTEM_ADMIN_QUORUM');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('OPEN', 'UNDER_INVESTIGATION', 'CHARGESHEETED', 'IN_TRIAL', 'CLOSED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."classification" AS ENUM('PUBLIC', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('FIR', 'POLICE_REPORT', 'INVESTIGATION_RECORD', 'WITNESS_STATEMENT', 'CHARGE_SHEET', 'COURT_FILING', 'EVIDENCE_RECORD', 'FORENSIC_REPORT', 'LEGAL_NOTICE', 'JUDGMENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."integrity_status" AS ENUM('VERIFIED', 'TAMPERED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."ledger_status" AS ENUM('PENDING_LEDGER', 'ANCHORED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."pool_type" AS ENUM('SYSTEM_ADMIN', 'SECURITY_ADMIN', 'ORG_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('SCANNING', 'OCR', 'INDEXING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('INVESTIGATING_OFFICER', 'SUPERVISOR', 'PROSECUTOR', 'JUDGE', 'COURT_CLERK', 'FORENSIC_ANALYST', 'RECORDS_ADMIN', 'SECURITY_ADMIN', 'ORG_ADMIN', 'SYSTEM_ADMIN', 'AUDITOR');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."sudo_action_type" AS ENUM('APPOINT_ORG_ADMIN', 'REMOVE_ORG_ADMIN', 'APPOINT_SYSTEM_ADMIN', 'REMOVE_SYSTEM_ADMIN', 'CHANGE_POOL_THRESHOLD', 'ONBOARD_ORG', 'CHANGE_ABAC_POLICY', 'POOL_REINSTATEMENT', 'GENESIS_REPLACEMENT');--> statement-breakpoint
CREATE TYPE "public"."sudo_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'OBJECTED', 'EXECUTED', 'EXPIRED');--> statement-breakpoint
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
	"ledger_status" "ledger_status" DEFAULT 'PENDING_LEDGER' NOT NULL,
	"anchored_at" timestamp with time zone,
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
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"role" "role" NOT NULL,
	"org_id" uuid NOT NULL,
	"badge_id" text,
	"email" text NOT NULL,
	"clearance" "classification" NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"status" "status" NOT NULL,
	"mfa_enrolled" boolean DEFAULT false NOT NULL,
	"mfa_temp_secret" text,
	"mfa_secret" text,
	"backup_codes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"username" text NOT NULL,
	"hashed_password" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "case_assignments" (
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_on_case" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid NOT NULL,
	CONSTRAINT "case_assignments_case_id_user_id_key" UNIQUE("case_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"status" "case_status" DEFAULT 'OPEN' NOT NULL,
	"classification" "classification" NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"legal_hold_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_case_number_key" UNIQUE("case_number")
);
--> statement-breakpoint
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
CREATE TABLE "admin_pool_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_pool_members_pool_id_user_id_key" UNIQUE("pool_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "admin_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_type" "pool_type" NOT NULL,
	"org_id" uuid,
	"k" integer NOT NULL,
	"m" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "genesis_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holder_label" text NOT NULL,
	"distributed_at" timestamp with time zone,
	"is_cold_stored" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sudo_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"approver_pool_role" "approver_pool_role" NOT NULL,
	"step_up_token_jti" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sudo_approvals_proposal_id_approver_id_key" UNIQUE("proposal_id","approver_id"),
	CONSTRAINT "sudo_approvals_step_up_token_jti_key" UNIQUE("step_up_token_jti")
);
--> statement-breakpoint
CREATE TABLE "sudo_objections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"objector_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sudo_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_type" "sudo_action_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "sudo_status" DEFAULT 'PENDING' NOT NULL,
	"proposed_by" uuid NOT NULL,
	"org_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executes_after" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"executed_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE "abac_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activation_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jurisdictions_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_restored_from_fkey" FOREIGN KEY ("restored_from_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_pool_members" ADD CONSTRAINT "admin_pool_members_pool_id_admin_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."admin_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_pools" ADD CONSTRAINT "admin_pools_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sudo_approvals" ADD CONSTRAINT "sudo_approvals_proposal_id_sudo_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."sudo_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sudo_objections" ADD CONSTRAINT "sudo_objections_proposal_id_sudo_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."sudo_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sudo_proposals" ADD CONSTRAINT "sudo_proposals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_versions_document_id_idx" ON "document_versions" USING btree ("document_id","version_no");--> statement-breakpoint
CREATE INDEX "document_versions_created_by_idx" ON "document_versions" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "document_versions_pending_idx" ON "document_versions" USING btree ("processing_status") WHERE "document_versions"."processing_status" <> 'READY' and "document_versions"."processing_status" <> 'FAILED';--> statement-breakpoint
CREATE INDEX "document_versions_ledger_pending_idx" ON "document_versions" USING btree ("ledger_status") WHERE "document_versions"."ledger_status" <> 'ANCHORED';--> statement-breakpoint
CREATE INDEX "documents_case_id_idx" ON "documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "documents_doc_type_idx" ON "documents" USING btree ("doc_type");--> statement-breakpoint
CREATE INDEX "documents_classification_idx" ON "documents" USING btree ("classification");--> statement-breakpoint
CREATE INDEX "documents_created_by_idx" ON "documents" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "documents_active_idx" ON "documents" USING btree ("case_id") WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "jurisdiction_idx" ON "users" USING btree ("jurisdiction_id");--> statement-breakpoint
CREATE INDEX "role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "case_assignments_case_id_idx" ON "case_assignments" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_assignments_user_id_idx" ON "case_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "case_assignments_role_on_case_idx" ON "case_assignments" USING btree ("role_on_case");--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cases_classification_idx" ON "cases" USING btree ("classification");--> statement-breakpoint
CREATE INDEX "cases_jurisdiction_idx" ON "cases" USING btree ("jurisdiction_id");--> statement-breakpoint
CREATE INDEX "cases_created_by_idx" ON "cases" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "cases_updated_at_idx" ON "cases" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_pool_members_pool_id_idx" ON "admin_pool_members" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "admin_pool_members_user_id_idx" ON "admin_pool_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_pools_singleton_idx" ON "admin_pools" USING btree ("pool_type") WHERE "admin_pools"."org_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_pools_type_org_idx" ON "admin_pools" USING btree ("pool_type","org_id") WHERE "admin_pools"."org_id" is not null;--> statement-breakpoint
CREATE INDEX "sudo_approvals_proposal_id_idx" ON "sudo_approvals" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "sudo_objections_proposal_id_idx" ON "sudo_objections" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "sudo_proposals_status_idx" ON "sudo_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sudo_proposals_action_type_idx" ON "sudo_proposals" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "sudo_proposals_proposed_by_idx" ON "sudo_proposals" USING btree ("proposed_by");--> statement-breakpoint
CREATE UNIQUE INDEX "abac_policies_version_key" ON "abac_policies" USING btree ("version");--> statement-breakpoint
CREATE INDEX "user_id_idx" ON "activation_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "token_idx" ON "activation_tokens" USING btree ("token");