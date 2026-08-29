-- Custom SQL migration file, put your code below! --
--
-- Governance / admin-hierarchy subsystem (GOVERNANCE.md).
--
-- Adds the k-of-m admin quorum pools, the sudo-proposal machinery (proposals,
-- approvals, objections) and the genesis-share ledger (metadata ONLY — Shamir
-- secret material is NEVER stored server-side). Enum value sets are declared in
-- full up front (incl. the actions reserved for the deferred Tier-2/3 recovery
-- passes) so growing governance later never needs an ALTER TYPE ... ADD VALUE.
--
-- Cross-domain FKs to users(id) / audit_log(id) follow the same conditional,
-- idempotent pattern as 0002/0004: added only if the target table exists and the
-- constraint isn't already present, RESTRICT so an actor with governance history
-- can never be deleted out from under the trail.
-- ============================================================================

-- ── enum types ──────────────────────────────────────────────────────────────
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'approver_pool_role') THEN
    CREATE TYPE "public"."approver_pool_role" AS ENUM(
      'IN_POOL', 'CROSS_TIER_SECURITY_ADMIN', 'AUDITOR_VOTE', 'SYSTEM_ADMIN_QUORUM'
    );
  END IF;
END $$;
--> statement-breakpoint

-- ── tables ──────────────────────────────────────────────────────────────────
CREATE TABLE "admin_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pool_type" "pool_type" NOT NULL,
	"org" text,
	"k" integer NOT NULL,
	"m" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_pools_k_range_check" CHECK ("admin_pools"."k" >= 2 AND "admin_pools"."k" <= "admin_pools"."m")
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

CREATE TABLE "sudo_proposals" (
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

CREATE TABLE "genesis_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holder_label" text NOT NULL,
	"distributed_at" timestamp with time zone,
	"is_cold_stored" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ── intra-domain FKs (targets created above, so unconditional) ───────────────
ALTER TABLE "admin_pool_members" ADD CONSTRAINT "admin_pool_members_pool_id_admin_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."admin_pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sudo_approvals" ADD CONSTRAINT "sudo_approvals_proposal_id_sudo_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."sudo_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sudo_objections" ADD CONSTRAINT "sudo_objections_proposal_id_sudo_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."sudo_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- ── partial unique indexes: one SYSTEM/SECURITY pool (org IS NULL), one ───────
-- ORG_ADMIN pool per org (org IS NOT NULL).
CREATE UNIQUE INDEX "admin_pools_singleton_idx" ON "admin_pools" USING btree ("pool_type") WHERE "admin_pools"."org" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_pools_type_org_idx" ON "admin_pools" USING btree ("pool_type","org") WHERE "admin_pools"."org" is not null;--> statement-breakpoint

-- ── secondary indexes ────────────────────────────────────────────────────────
CREATE INDEX "admin_pool_members_pool_id_idx" ON "admin_pool_members" USING btree ("pool_id");--> statement-breakpoint
CREATE INDEX "admin_pool_members_user_id_idx" ON "admin_pool_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sudo_proposals_status_idx" ON "sudo_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sudo_proposals_action_type_idx" ON "sudo_proposals" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "sudo_proposals_proposed_by_idx" ON "sudo_proposals" USING btree ("proposed_by");--> statement-breakpoint
CREATE INDEX "sudo_approvals_proposal_id_idx" ON "sudo_approvals" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "sudo_objections_proposal_id_idx" ON "sudo_objections" USING btree ("proposal_id");--> statement-breakpoint

-- ── cross-domain FKs to users(id) / audit_log(id) (conditional + idempotent) ──
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_pool_members_user_id_fkey') THEN
      ALTER TABLE "admin_pool_members"
        ADD CONSTRAINT "admin_pool_members_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sudo_proposals_proposed_by_fkey') THEN
      ALTER TABLE "sudo_proposals"
        ADD CONSTRAINT "sudo_proposals_proposed_by_fkey"
        FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sudo_approvals_approver_id_fkey') THEN
      ALTER TABLE "sudo_approvals"
        ADD CONSTRAINT "sudo_approvals_approver_id_fkey"
        FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sudo_objections_objector_id_fkey') THEN
      ALTER TABLE "sudo_objections"
        ADD CONSTRAINT "sudo_objections_objector_id_fkey"
        FOREIGN KEY ("objector_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
    END IF;
  ELSE
    RAISE NOTICE 'skipping governance -> users FKs: table "users" does not exist yet';
  END IF;

  IF to_regclass('public.audit_log') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sudo_proposals_executed_entry_id_fkey') THEN
      ALTER TABLE "sudo_proposals"
        ADD CONSTRAINT "sudo_proposals_executed_entry_id_fkey"
        FOREIGN KEY ("executed_entry_id") REFERENCES "public"."audit_log"("id") ON DELETE RESTRICT;
    END IF;
  ELSE
    RAISE NOTICE 'skipping sudo_proposals_executed_entry_id_fkey: table "audit_log" does not exist yet';
  END IF;
END $$;
