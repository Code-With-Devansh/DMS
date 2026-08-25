import { pgEnum } from "drizzle-orm/pg-core";

// Shared vocabulary — single source of truth. `classification` and `doc_type`
// are used by other domains too (users.clearance, cases, acls); teammates must
// IMPORT these, not redefine them (a second pgEnum would emit a duplicate
// CREATE TYPE and break generation).

export const classification = pgEnum("classification", [
  "PUBLIC",
  "RESTRICTED",
  "CONFIDENTIAL",
  "SECRET",
]);


export const docType = pgEnum("doc_type", [
  "FIR",
  "POLICE_REPORT",
  "INVESTIGATION_RECORD",
  "WITNESS_STATEMENT",
  "CHARGE_SHEET",
  "COURT_FILING",
  "EVIDENCE_RECORD",
  "FORENSIC_REPORT",
  "LEGAL_NOTICE",
  "JUDGMENT",
  "OTHER",
]);

// Per-version integrity verdict (content hash vs. ledger). Set by the security layer.
export const integrityStatus = pgEnum("integrity_status", [
  "VERIFIED",
  "TAMPERED",
  "PENDING",
]);

// Per-version async pipeline state (virus scan -> OCR -> index -> ready).
export const processingStatus = pgEnum("processing_status", [
  "SCANNING",
  "OCR",
  "INDEXING",
  "READY",
  "FAILED",
]);


