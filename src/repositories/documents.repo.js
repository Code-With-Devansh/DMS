import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { documents, documentVersions, documentAccessGrants } from "../db/schema/index.js";

// ── documents ────────────────────────────────────────────────────────────────
export async function insertDocument(tx, values) {
  const [row] = await tx.insert(documents).values(values).returning();
  return row;
}

export async function getDocumentById(id) {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)));
  return row ?? null;
}

// One page of a case's live documents, each left-joined to its current version
// so the summary can show current version number + processing/integrity status.
export async function listDocumentsByCase(caseId, { page, pageSize }) {
  const where = and(eq(documents.caseId, caseId), isNull(documents.deletedAt));
  const rows = await db
    .select({ doc: documents, ver: documentVersions })
    .from(documents)
    .leftJoin(
      documentVersions,
      eq(documents.currentVersionId, documentVersions.id),
    )
    .where(where)
    .orderBy(desc(documents.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db
    .select({ total: count() })
    .from(documents)
    .where(where);
  return { rows, total: Number(total) };
}

// ── document_versions ─────────────────────────────────────────────────────────
export async function insertVersion(tx, values) {
  // version_no is intentionally omitted: a BEFORE INSERT trigger assigns it
  // (MAX+1 per document, race-safe) and an AFTER INSERT trigger points
  // documents.current_version_id at this new row.
  const [row] = await tx.insert(documentVersions).values(values).returning();
  return row;
}

export async function getVersion(documentId, versionId) {
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        eq(documentVersions.id, versionId),
      ),
    );
  return row ?? null;
}

export async function getVersionById(versionId) {
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.id, versionId));
  return row ?? null;
}

export async function listVersions(documentId) {
  return db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.versionNo));
}

export async function countVersions(documentId) {
  const [row] = await db
    .select({ total: count() })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));
  return Number(row?.total ?? 0);
}

// ── ledger anchoring state transitions ─────────────────────────────────────────
// Both run inside the anchor worker's transaction (so the row change commits
// atomically with its audit entry). They touch only the mutable ledger columns,
// which the immutability guard trigger permits.

// PENDING_LEDGER -> ANCHORED: stamp the on-chain tx id and anchor time.
export async function setLedgerAnchored(tx, { versionId, ledgerTxId, anchoredAt }) {
  const [row] = await tx
    .update(documentVersions)
    .set({ ledgerStatus: "ANCHORED", ledgerTxId, anchoredAt })
    .where(eq(documentVersions.id, versionId))
    .returning();
  return row ?? null;
}

// PENDING_LEDGER -> FAILED: anchoring abandoned after exhausting retries. Leaves
// ledger_tx_id/anchored_at null so a reconciliation sweep can retry later.
export async function setLedgerFailed(tx, { versionId }) {
  const [row] = await tx
    .update(documentVersions)
    .set({ ledgerStatus: "FAILED" })
    .where(eq(documentVersions.id, versionId))
    .returning();
  return row ?? null;
}

// ── integrity + seal state transitions ─────────────────────────────────────────

// Record the outcome of an integrity re-hash on a version. Touches only the
// mutable pipeline columns (integrity_status, integrity_checked_at) that the
// immutability guard trigger permits. Runs inside the verify request's transaction
// so the row change commits atomically with its audit entry.
export async function setIntegrityChecked(tx, { versionId, integrityStatus, integrityCheckedAt }) {
  const [row] = await tx
    .update(documentVersions)
    .set({ integrityStatus, integrityCheckedAt })
    .where(eq(documentVersions.id, versionId))
    .returning();
  return row ?? null;
}

// Seal a document: flip documents.sealed so addVersion/restore refuse further
// versions. Runs inside the seal request's transaction, after the ledger seal has
// been submitted, alongside the DOCUMENT_SEALED audit entry.
export async function setDocumentSealed(tx, { documentId }) {
  const [row] = await tx
    .update(documents)
    .set({ sealed: true, updatedAt: new Date() })
    .where(eq(documents.id, documentId))
    .returning();
  return row ?? null;
}

// ── document access grants ──────────────────────────────────────────────────
// Upsert on (documentId, granteeUserId): a second grant to the same person just
// updates expiresAt (and un-revokes, if it had been revoked) rather than erroring.
export async function upsertAccessGrant(tx, { documentId, granteeUserId, grantedBy, expiresAt, crossJurisdiction }) {
  const [row] = await tx
    .insert(documentAccessGrants)
    .values({ documentId, granteeUserId, grantedBy, expiresAt, crossJurisdiction })
    .onConflictDoUpdate({
      target: [documentAccessGrants.documentId, documentAccessGrants.granteeUserId],
      set: { grantedBy, expiresAt, crossJurisdiction, revokedAt: null, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function findAccessGrant(documentId, granteeUserId, tx = db) {
  const [row] = await tx
    .select()
    .from(documentAccessGrants)
    .where(and(eq(documentAccessGrants.documentId, documentId), eq(documentAccessGrants.granteeUserId, granteeUserId)))
    .limit(1);
  return row ?? null;
}

// The actual PDP check (authorize.js): does this user have a live grant — not
// revoked, not expired — for this document? Narrow enough to hit
// document_access_grants_active_idx plus a single expiresAt compare.
export async function hasActiveAccessGrant(documentId, granteeUserId) {
  const [row] = await db
    .select({ id: documentAccessGrants.id })
    .from(documentAccessGrants)
    .where(
      and(
        eq(documentAccessGrants.documentId, documentId),
        eq(documentAccessGrants.granteeUserId, granteeUserId),
        isNull(documentAccessGrants.revokedAt),
        gt(documentAccessGrants.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function revokeAccessGrant(tx, { documentId, granteeUserId }) {
  const [row] = await tx
    .update(documentAccessGrants)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(documentAccessGrants.documentId, documentId),
        eq(documentAccessGrants.granteeUserId, granteeUserId),
        isNull(documentAccessGrants.revokedAt),
      ),
    )
    .returning();
  return row ?? null;
}

export async function listAccessGrants(documentId) {
  return db
    .select()
    .from(documentAccessGrants)
    .where(and(eq(documentAccessGrants.documentId, documentId), isNull(documentAccessGrants.revokedAt)))
    .orderBy(desc(documentAccessGrants.createdAt));
}
