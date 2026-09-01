
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approver_pool_role') THEN
    CREATE TYPE "public"."approver_pool_role" AS ENUM(
      'IN_POOL', 'CROSS_TIER_SECURITY_ADMIN', 'AUDITOR_VOTE', 'SYSTEM_ADMIN_QUORUM'
    );
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pool_type') THEN
    CREATE TYPE "public"."pool_type" AS ENUM('SYSTEM_ADMIN', 'SECURITY_ADMIN', 'ORG_ADMIN');
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sudo_action_type') THEN
    CREATE TYPE "public"."sudo_action_type" AS ENUM(
      'APPOINT_ORG_ADMIN',
      'REMOVE_ORG_ADMIN',
      'APPOINT_SYSTEM_ADMIN',
      'REMOVE_SYSTEM_ADMIN',
      'CHANGE_POOL_THRESHOLD',
      'ONBOARD_ORG',
      'CHANGE_ABAC_POLICY',
      'POOL_REINSTATEMENT',
      'GENESIS_REPLACEMENT'
    );
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sudo_status') THEN
    CREATE TYPE "public"."sudo_status" AS ENUM(
      'PENDING', 'APPROVED', 'REJECTED', 'OBJECTED', 'EXECUTED', 'EXPIRED'
    );
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_pool_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_pool_members_pool_id_user_id_key" UNIQUE("pool_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_type" "pool_type" NOT NULL,
	"org" text,
	"k" integer NOT NULL,
	"m" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "genesis_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holder_label" text NOT NULL,
	"distributed_at" timestamp with time zone,
	"is_cold_stored" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sudo_approvals" (
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
CREATE TABLE IF NOT EXISTS "sudo_objections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"objector_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sudo_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_type" "sudo_action_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "sudo_status" DEFAULT 'PENDING' NOT NULL,
	"proposed_by" uuid NOT NULL,
	"org" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executes_after" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"executed_entry_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activation_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP CONSTRAINT IF EXISTS "refresh_tokens_new_refresh_token_id_refresh_tokens_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "users_username_key";--> statement-breakpoint
DROP INDEX IF EXISTS "users_email_key";--> statement-breakpoint
DROP INDEX IF EXISTS "users_role_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "users_org_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "users_status_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "refresh_tokens_expires_at_idx";--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_pool_members_pool_id_admin_pools_id_fk') THEN
    ALTER TABLE "admin_pool_members"
      ADD CONSTRAINT "admin_pool_members_pool_id_admin_pools_id_fk"
      FOREIGN KEY ("pool_id") REFERENCES "public"."admin_pools"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sudo_approvals_proposal_id_sudo_proposals_id_fk') THEN
    ALTER TABLE "sudo_approvals"
      ADD CONSTRAINT "sudo_approvals_proposal_id_sudo_proposals_id_fk"
      FOREIGN KEY ("proposal_id") REFERENCES "public"."sudo_proposals"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sudo_objections_proposal_id_sudo_proposals_id_fk') THEN
    ALTER TABLE "sudo_objections"
      ADD CONSTRAINT "sudo_objections_proposal_id_sudo_proposals_id_fk"
      FOREIGN KEY ("proposal_id") REFERENCES "public"."sudo_proposals"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_pool_members_pool_id_idx" ON "admin_pool_members" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_pool_members_user_id_idx" ON "admin_pool_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_pools_singleton_idx" ON "admin_pools" USING btree ("pool_type") WHERE "admin_pools"."org" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_pools_type_org_idx" ON "admin_pools" USING btree ("pool_type","org") WHERE "admin_pools"."org" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sudo_approvals_proposal_id_idx" ON "sudo_approvals" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sudo_objections_proposal_id_idx" ON "sudo_objections" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sudo_proposals_status_idx" ON "sudo_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sudo_proposals_action_type_idx" ON "sudo_proposals" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sudo_proposals_proposed_by_idx" ON "sudo_proposals" USING btree ("proposed_by");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "abac_policies_version_key" ON "abac_policies" USING btree ("version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_id_idx" ON "activation_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "token_idx" ON "activation_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "org_idx" ON "users" USING btree ("org");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "status_idx" ON "users" USING btree ("status");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_changed_at";--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP COLUMN IF EXISTS "new_refresh_token_id";--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_unique') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_username_unique') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_username_unique" UNIQUE("username");
  END IF;
END $$;