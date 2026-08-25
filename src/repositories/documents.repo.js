import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { documents, documentVersions } from "../db/schema/index.js";

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
