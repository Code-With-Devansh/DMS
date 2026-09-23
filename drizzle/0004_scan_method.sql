-- Custom, hand-written migration (same pattern as 0002/0003). Adds
-- document_extractions.scan_method so it's auditable, per document, whether
-- a document went through real malware detection (ClamAV) or only the
-- rule-based type/format checks in src/processing/ruleBasedScanner.js — the
-- prototype's scanner has no malware detection at all, and this column is
-- what keeps that gap visible instead of a rules-only-scanned document
-- looking identical to a ClamAV-scanned one after the fact.
--
-- Default 'clamav' on the ALTER TABLE reflects the honest history: any row
-- that already exists was scanned before this column existed, i.e. by
-- ClamAV. Every row written from here on sets this explicitly (see
-- documentProcessing.processor.js) rather than relying on the default.

ALTER TABLE document_extractions
  ADD COLUMN scan_method text NOT NULL DEFAULT 'clamav';
