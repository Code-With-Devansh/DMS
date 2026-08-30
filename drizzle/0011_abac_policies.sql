-- ABAC policy overlay store (CHANGE_ABAC_POLICY sudo action).
-- Append-only: each row is a full override document layered on the hardcoded
-- defaults (src/lib/abacPolicy.js). Active policy = row with MAX(version).
-- Hand-written per the migration-drift rule (never db:generate); apply with
-- `npm run migrate`. Idempotent so re-runs against a partially-migrated DB
-- are safe.

CREATE TABLE IF NOT EXISTS "abac_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- version is monotonic; the unique index is the append-only backstop against a
-- concurrent execute racing two rows onto the same version number.
CREATE UNIQUE INDEX IF NOT EXISTS "abac_policies_version_key" ON "abac_policies" USING btree ("version");--> statement-breakpoint

-- cross-domain FK to users(id) (conditional + idempotent, mirroring 0010:150).
-- RESTRICT: a founder who has ever authored a policy version cannot be hard
-- deleted (their versions are part of the audit trail).
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'abac_policies_created_by_fkey') THEN
      ALTER TABLE "abac_policies"
        ADD CONSTRAINT "abac_policies_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;
