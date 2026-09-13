-- Custom, hand-written migration (not drizzle-kit generated — see the comments
-- in src/db/schema/documents.js and src/db/schema/documentIntelligence.js that
-- reference this file by name). Implements the three DB-level guarantees the
-- application code assumes but never enforces itself:
--
--   1. version_no is auto-assigned per document (MAX+1), never supplied by the
--      app (see repositories/documents.repo.js#insertVersion).
--   2. documents.current_version_id is kept pointed at the newest version of
--      that document after every insert.
--   3. document_versions is append-only: once a row exists, only the mutable
--      pipeline columns (processing/integrity/ledger state) may ever change;
--      everything else — content pointer, fingerprint, provenance — is frozen.

-- 1. version_no auto-assignment (BEFORE INSERT).
-- The unique (document_id, version_no) constraint from 0000 is the race-safe
-- backstop: a concurrent insert computing the same next number will fail the
-- unique constraint and can be retried by the caller, rather than silently
-- duplicating a version number.
CREATE OR REPLACE FUNCTION assign_document_version_no()
RETURNS trigger AS $$
BEGIN
  IF NEW.version_no IS NULL THEN
    SELECT COALESCE(MAX(version_no), 0) + 1
      INTO NEW.version_no
      FROM document_versions
      WHERE document_id = NEW.document_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER document_versions_assign_version_no
  BEFORE INSERT ON document_versions
  FOR EACH ROW
  EXECUTE FUNCTION assign_document_version_no();
--> statement-breakpoint

-- 2. documents.current_version_id sync (AFTER INSERT).
-- A version is only ever INSERTed as the new latest version (restore creates a
-- brand-new row too — see documents.service.js), so every insert becomes current.
CREATE OR REPLACE FUNCTION sync_document_current_version()
RETURNS trigger AS $$
BEGIN
  UPDATE documents
    SET current_version_id = NEW.id,
        updated_at = now()
    WHERE id = NEW.document_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER document_versions_sync_current_version
  AFTER INSERT ON document_versions
  FOR EACH ROW
  EXECUTE FUNCTION sync_document_current_version();
--> statement-breakpoint

-- 3. Append-only / immutability guard (BEFORE UPDATE).
-- Whitelist is exactly the set of columns the app ever updates (see
-- setProcessingStatus, setLedgerAnchored, setLedgerFailed and the integrity
-- check writer in documents.repo.js). Anything else changing is a bug, not a
-- legitimate edit — evidence rows don't get corrected, they get a new version.
CREATE OR REPLACE FUNCTION guard_document_version_immutability()
RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.version_no IS DISTINCT FROM OLD.version_no
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.restored_from_version_id IS DISTINCT FROM OLD.restored_from_version_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'document_versions is append-only: only processing_status, integrity_status, integrity_checked_at, ledger_tx_id, ledger_status and anchored_at may be updated (row %)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER document_versions_guard_immutability
  BEFORE UPDATE ON document_versions
  FOR EACH ROW
  EXECUTE FUNCTION guard_document_version_immutability();
