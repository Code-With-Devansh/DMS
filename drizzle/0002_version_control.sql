-- Custom migration (not drizzle-generated): implements the trigger-based
-- version control described in src/db/schema/documents.js comments, which
-- was documented but never actually shipped as a migration. Fixes:
--   1) document_versions.version_no NOT NULL violations on insert
--      (src/repositories/documents.repo.js insertVersion relies on this)
--   2) documents.current_version_id never advancing to the newest version
--   3) document_versions rows being mutable/deletable after creation, even
--      though the schema comments call them "IMMUTABLE + APPEND-ONLY"

-- ── 1. BEFORE INSERT: assign version_no = MAX(version_no)+1 per document ──────
-- Locks the parent `documents` row first (FOR UPDATE) so concurrent uploads to
-- the same document serialize instead of racing on the MAX() read; the
-- existing UNIQUE(document_id, version_no) constraint remains as a backstop.
CREATE OR REPLACE FUNCTION document_versions_assign_version_no()
RETURNS TRIGGER AS $$
DECLARE
  next_no integer;
BEGIN
  PERFORM 1 FROM documents WHERE id = NEW.document_id FOR UPDATE;

  SELECT COALESCE(MAX(version_no), 0) + 1
    INTO next_no
    FROM document_versions
   WHERE document_id = NEW.document_id;

  NEW.version_no := next_no;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_versions_before_insert_version_no
  BEFORE INSERT ON document_versions
  FOR EACH ROW
  EXECUTE FUNCTION document_versions_assign_version_no();

-- ── 2. AFTER INSERT: point documents.current_version_id at the new version ────
-- Runs after version_no has been assigned above, so this always points at the
-- highest version_no for the document (new rows are always the newest).
CREATE OR REPLACE FUNCTION document_versions_set_current_version()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE documents
     SET current_version_id = NEW.id,
         updated_at = now()
   WHERE id = NEW.document_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_versions_after_insert_current_version
  AFTER INSERT ON document_versions
  FOR EACH ROW
  EXECUTE FUNCTION document_versions_set_current_version();

-- ── 3. Immutability guard: block UPDATE of any column except the documented ───
-- mutable set (async pipeline state) and block DELETE entirely. Matches the
-- "the ONLY mutable columns" comment in src/db/schema/documents.js.
CREATE OR REPLACE FUNCTION document_versions_guard_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'document_versions rows are append-only and cannot be deleted (id=%)', OLD.id;
  END IF;

  IF NEW.id                     IS DISTINCT FROM OLD.id
     OR NEW.document_id         IS DISTINCT FROM OLD.document_id
     OR NEW.version_no          IS DISTINCT FROM OLD.version_no
     OR NEW.file_name           IS DISTINCT FROM OLD.file_name
     OR NEW.storage_key         IS DISTINCT FROM OLD.storage_key
     OR NEW.mime_type           IS DISTINCT FROM OLD.mime_type
     OR NEW.size_bytes          IS DISTINCT FROM OLD.size_bytes
     OR NEW.sha256              IS DISTINCT FROM OLD.sha256
     OR NEW.note                IS DISTINCT FROM OLD.note
     OR NEW.restored_from_version_id IS DISTINCT FROM OLD.restored_from_version_id
     OR NEW.created_by          IS DISTINCT FROM OLD.created_by
     OR NEW.created_at          IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'document_versions rows are immutable except for processing/ledger/integrity state (id=%)', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_versions_guard_immutability
  BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW
  EXECUTE FUNCTION document_versions_guard_immutability();
