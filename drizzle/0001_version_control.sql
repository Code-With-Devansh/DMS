-- Custom SQL migration file, put your code below! --
--
-- Version-control invariants for the document-management slice.
-- Drizzle's schema DSL can't express triggers/functions or the circular FK
-- between documents and document_versions, so they live here.
-- ============================================================================


-- ── 1. Circular FK: documents.current_version_id -> document_versions.id ─────
-- Left out of the Drizzle schema to avoid a create-order cycle (each table
-- references the other). Added here now that both tables exist.
-- ON DELETE SET NULL is defensive only: document_versions rows are never
-- deleted (see the prevent-delete trigger below).
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_current_version_id_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id")
  ON DELETE SET NULL;
--> statement-breakpoint


-- ── 2. documents.updated_at auto-maintenance ────────────────────────────────
-- Shared utility function (teammates may reuse it for their own updated_at).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON "documents"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint


-- ── 3. Auto-assign version_no (race-free, gap-free) ─────────────────────────
-- If the caller leaves version_no NULL, assign MAX(version_no)+1 for the
-- document. Locking the parent documents row FOR UPDATE serializes concurrent
-- uploads to the same document, so two versions can never collide on a number
-- (the UNIQUE(document_id, version_no) constraint is the backstop).
CREATE OR REPLACE FUNCTION document_versions_assign_no() RETURNS trigger AS $$
BEGIN
  IF NEW.version_no IS NULL THEN
    PERFORM 1 FROM "documents" WHERE id = NEW.document_id FOR UPDATE;
    SELECT COALESCE(MAX(version_no), 0) + 1
      INTO NEW.version_no
      FROM "document_versions"
     WHERE document_id = NEW.document_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER document_versions_assign_no
  BEFORE INSERT ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION document_versions_assign_no();
--> statement-breakpoint


-- ── 4. Keep documents.current_version_id pointed at the newest version ──────
-- Runs AFTER INSERT so NEW.id exists. A "restore" is just another INSERT, so
-- restoring an old version correctly makes it the current one.
CREATE OR REPLACE FUNCTION document_versions_set_current() RETURNS trigger AS $$
BEGIN
  UPDATE "documents"
     SET current_version_id = NEW.id
   WHERE id = NEW.document_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER document_versions_set_current
  AFTER INSERT ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION document_versions_set_current();
--> statement-breakpoint


-- ── 5. Append-only: block all deletes ───────────────────────────────────────
-- Versions are evidence. Retire a document via documents.deleted_at instead.
CREATE OR REPLACE FUNCTION document_versions_prevent_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'document_versions is append-only; deletes are not permitted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER document_versions_prevent_delete
  BEFORE DELETE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION document_versions_prevent_delete();
--> statement-breakpoint


-- ── 6. Immutable evidentiary columns ────────────────────────────────────────
-- A version's content pointer, hash, and provenance are frozen once written.
-- Only the async security/processing pipeline columns may transition:
--   processing_status, integrity_status, ledger_tx_id, integrity_checked_at.
-- Any attempt to change an evidentiary column is rejected.
CREATE OR REPLACE FUNCTION document_versions_guard_update() RETURNS trigger AS $$
BEGIN
  IF NEW.id                       IS DISTINCT FROM OLD.id
  OR NEW.document_id              IS DISTINCT FROM OLD.document_id
  OR NEW.version_no               IS DISTINCT FROM OLD.version_no
  OR NEW.file_name                IS DISTINCT FROM OLD.file_name
  OR NEW.storage_key              IS DISTINCT FROM OLD.storage_key
  OR NEW.mime_type                IS DISTINCT FROM OLD.mime_type
  OR NEW.size_bytes               IS DISTINCT FROM OLD.size_bytes
  OR NEW.sha256                   IS DISTINCT FROM OLD.sha256
  OR NEW.note                     IS DISTINCT FROM OLD.note
  OR NEW.restored_from_version_id IS DISTINCT FROM OLD.restored_from_version_id
  OR NEW.created_by               IS DISTINCT FROM OLD.created_by
  OR NEW.created_at               IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'document_versions rows are immutable; only processing_status, integrity_status, ledger_tx_id, integrity_checked_at may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER document_versions_guard_update
  BEFORE UPDATE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION document_versions_guard_update();
