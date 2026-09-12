-- document_extractions_pending_idx, split out from 0003_document_intelligence.sql.
-- It has to live in its own migration: 0003 adds the QUARANTINED enum value,
-- and Postgres refuses to use a value added earlier in the same transaction as
-- an enum literal until that transaction commits. Once it has, this can compare
-- against plain enum literals (immutable) instead of casting status to text
-- (enum-to-text uses the enum's output function, which Postgres marks STABLE
-- rather than IMMUTABLE, so it isn't allowed in an index predicate).
CREATE INDEX "document_extractions_pending_idx" ON "document_extractions" USING btree ("status") WHERE "document_extractions"."status" not in ('READY', 'FAILED', 'QUARANTINED');
