-- Custom SQL migration file, put your code below! --
--
-- Make audit_log append-only, and link actor_id to users when that table exists.
--
-- Tamper-evidence is layered: the app computes a hash chain (entry_hash =
-- sha256(prev_hash || canonical(payload))), and these triggers stop the rows
-- from being rewritten or removed in the first place. UPDATE / DELETE / TRUNCATE
-- all raise. INSERT is the only permitted write. A table owner could still drop
-- these triggers, but any such tampering is exactly what re-walking the chain
-- (GET /audit/verify) is designed to expose.
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_log_prevent_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_update ON "audit_log";--> statement-breakpoint
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_change();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_delete ON "audit_log";--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_change();
--> statement-breakpoint

DROP TRIGGER IF EXISTS audit_log_no_truncate ON "audit_log";--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_prevent_change();
--> statement-breakpoint

-- actor_id -> users(id): added only if the (teammate-owned) users table exists,
-- mirroring the created_by FKs in 0002. RESTRICT so an actor with audit history
-- can never be deleted out from under the trail.
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_actor_id_fkey'
    ) THEN
      ALTER TABLE "audit_log"
        ADD CONSTRAINT "audit_log_actor_id_fkey"
        FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT;
    END IF;
  ELSE
    RAISE NOTICE 'skipping audit_log_actor_id_fkey: table "users" does not exist yet';
  END IF;
END $$;
