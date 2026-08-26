// Canonical labels for audit_log.action and .target_type. Kept as plain string
// constants (the DB column is text, not an enum) so adding an action never needs
// a migration. Import these instead of hardcoding strings at call sites.
export const AuditAction = Object.freeze({
  DOCUMENT_CREATED: "DOCUMENT_CREATED",
  VERSION_ADDED: "VERSION_ADDED",
  VERSION_RESTORED: "VERSION_RESTORED",
  VERSION_DOWNLOADED: "VERSION_DOWNLOADED",
  // Ledger anchoring (blockchain integrity layer). Emitted by the anchor worker,
  // not the request path: VERSION_ANCHORED when a version's hash commits to the
  // ledger, VERSION_ANCHOR_FAILED when anchoring is abandoned after retries.
  VERSION_ANCHORED: "VERSION_ANCHORED",
  VERSION_ANCHOR_FAILED: "VERSION_ANCHOR_FAILED",
  // Wired once the corresponding endpoints land:
  DOCUMENT_SEALED: "DOCUMENT_SEALED",
  DOCUMENT_DELETED: "DOCUMENT_DELETED",
});

export const TargetType = Object.freeze({
  DOCUMENT: "DOCUMENT",
  VERSION: "VERSION",
  CASE: "CASE",
});
