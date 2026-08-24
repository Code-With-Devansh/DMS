-- Custom SQL migration file, put your code below! --
--
-- FKs from my slice to teammate-owned tables (users, cases).
--
-- These tables may not exist yet when this migration runs (I develop my slice
-- independently), so each constraint is added ONLY IF its target table exists
-- and the constraint isn't already present. In a fully integrated database
-- where the users/cases migrations sort earlier, all three attach here; in a
-- standalone run they're skipped with a NOTICE.
--
-- When users/cases join the Drizzle schema, EITHER keep this migration OR
-- switch those columns to .references() in the schema — not both (duplicate FK).
-- ============================================================================

DO $$
BEGIN
  -- documents.case_id -> cases(id)
  IF to_regclass('public.cases') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'documents_case_id_fkey'
    ) THEN
      ALTER TABLE "documents"
        ADD CONSTRAINT "documents_case_id_fkey"
        FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE RESTRICT;
    END IF;
  ELSE
    RAISE NOTICE 'skipping documents_case_id_fkey: table "cases" does not exist yet';
  END IF;

  -- documents.created_by -> users(id)
  IF to_regclass('public.users') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'documents_created_by_fkey'
    ) THEN
      ALTER TABLE "documents"
        ADD CONSTRAINT "documents_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;
    END IF;

    -- document_versions.created_by -> users(id)
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'document_versions_created_by_fkey'
    ) THEN
      ALTER TABLE "document_versions"
        ADD CONSTRAINT "document_versions_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT;
    END IF;
  ELSE
    RAISE NOTICE 'skipping created_by FKs: table "users" does not exist yet';
  END IF;
END $$;
