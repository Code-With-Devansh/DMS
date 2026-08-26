-- Refresh the immutability guard's advisory message only. The frozen-column
-- deny-list (the IF-chain) is UNCHANGED and byte-for-byte identical to
-- 0001_version_control.sql; the async pipeline columns stay mutable by omission.
-- Since 0006 the pipeline also owns ledger_status + anchored_at, so the old
-- RAISE text under-listed what may change. This corrects the self-documenting
-- security policy without altering any enforcement logic.
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
    RAISE EXCEPTION 'document_versions rows are immutable; only processing_status, integrity_status, integrity_checked_at, ledger_status, ledger_tx_id, anchored_at may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
