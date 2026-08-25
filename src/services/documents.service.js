import { randomUUID, createHash } from "node:crypto";
import { db } from "../db/index.js";
import { storage, versionStorageKey } from "../storage/index.js";
import { conflict, notFound } from "../lib/errors.js";
import * as repo from "../repositories/documents.repo.js";
import { recordAudit, AuditAction, TargetType } from "../audit/index.js";

// ── DTO mappers (shapes per DESIGN §13) ───────────────────────────────────────
function toVersionDTO(v) {
  return {
    id: v.id,
    documentId: v.documentId,
    versionNo: v.versionNo,
    fileName: v.fileName,
    mimeType: v.mimeType,
    sizeBytes: Number(v.sizeBytes),
    sha256: v.sha256,
    ledgerTxId: v.ledgerTxId ?? undefined,
    signatureCount: 0, // signatures not implemented yet (DESIGN §4)
    uploadedBy: { id: v.createdBy }, // hydrate to UserSummary once users lands
    note: v.note ?? undefined,
    processingStatus: v.processingStatus,
    integrityStatus: v.integrityStatus,
    createdAt: v.createdAt,
  };
}

function toDocumentDTO(doc, currentVer, versionsCount) {
  return {
    id: doc.id,
    caseId: doc.caseId,
    title: doc.title,
    docType: doc.docType,
    classification: doc.classification,
    description: doc.description ?? undefined,
    currentVersionId: doc.currentVersionId,
    currentVersionNo: currentVer?.versionNo ?? null,
    integrityStatus: currentVer?.integrityStatus ?? "PENDING",
    processingStatus: currentVer?.processingStatus ?? "READY",
    versionsCount,
    tags: doc.tags ?? [],
    sealed: doc.sealed,
    createdBy: { id: doc.createdBy },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toDocumentSummaryDTO(doc, currentVer) {
  return {
    id: doc.id,
    caseId: doc.caseId,
    title: doc.title,
    docType: doc.docType,
    classification: doc.classification,
    currentVersionNo: currentVer?.versionNo ?? null,
    integrityStatus: currentVer?.integrityStatus ?? "PENDING",
    processingStatus: currentVer?.processingStatus ?? "READY",
    updatedAt: doc.updatedAt,
  };
}

const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

// ── operations ────────────────────────────────────────────────────────────────

// Upload a file as the first version of a new document.
export async function createDocument({ caseId, userId, ip, file, metadata }) {
  const documentId = randomUUID();
  const versionId = randomUUID();
  const storageKey = versionStorageKey({ caseId, documentId, versionId });
  const sha256 = sha256Hex(file.buffer);

  // Store the bytes FIRST, then commit metadata. If the DB write fails we delete
  // the orphaned object, so a committed row always has its bytes behind it.
  await storage.putObject({
    key: storageKey,
    body: file.buffer,
    contentType: file.mimetype,
    metadata: { sha256 },
  });

  try {
    await db.transaction(async (tx) => {
      await repo.insertDocument(tx, {
        id: documentId,
        caseId,
        title: metadata.title,
        docType: metadata.docType,
        classification: metadata.classification,
        description: metadata.description,
        tags: metadata.tags ?? [],
        createdBy: userId,
      });
      const version = await repo.insertVersion(tx, {
        id: versionId,
        documentId,
        fileName: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256,
        createdBy: userId,
        // Our only synchronous "processing" is hashing. The virus-scan/OCR/NER
        // BullMQ pipeline (DESIGN §11) will reintroduce SCANNING->READY later.
        processingStatus: "READY",
      });
      // Same transaction: no document exists without its "created" audit entry.
      await recordAudit(tx, {
        actorId: userId,
        action: AuditAction.DOCUMENT_CREATED,
        targetType: TargetType.DOCUMENT,
        targetId: documentId,
        ip,
        details: {
          caseId,
          title: metadata.title,
          docType: metadata.docType,
          classification: metadata.classification,
          versionNo: version.versionNo,
          fileName: version.fileName,
          sha256,
        },
      });
    });
  } catch (err) {
    await storage.deleteObject(storageKey).catch(() => {});
    throw err;
  }

  return getDocument(documentId);
}

// Upload a new immutable version of an existing document.
export async function addVersion({ documentId, userId, ip, file, metadata }) {
  const doc = await repo.getDocumentById(documentId);
  if (!doc) throw notFound("document not found");
  if (doc.sealed) throw conflict("document is sealed; no new versions allowed");

  const versionId = randomUUID();
  const storageKey = versionStorageKey({
    caseId: doc.caseId,
    documentId,
    versionId,
  });
  const sha256 = sha256Hex(file.buffer);

  await storage.putObject({
    key: storageKey,
    body: file.buffer,
    contentType: file.mimetype,
    metadata: { sha256 },
  });

  let version;
  try {
    version = await db.transaction(async (tx) => {
      const inserted = await repo.insertVersion(tx, {
        id: versionId,
        documentId,
        fileName: file.originalname,
        storageKey,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256,
        note: metadata.note,
        createdBy: userId,
        processingStatus: "READY",
      });
      await recordAudit(tx, {
        actorId: userId,
        action: AuditAction.VERSION_ADDED,
        targetType: TargetType.VERSION,
        targetId: versionId,
        ip,
        details: {
          documentId,
          versionNo: inserted.versionNo,
          fileName: inserted.fileName,
          sha256,
          note: metadata.note ?? null,
        },
      });
      return inserted;
    });
  } catch (err) {
    await storage.deleteObject(storageKey).catch(() => {});
    throw err;
  }

  return toVersionDTO(version);
}

export async function getDocument(id) {
  const doc = await repo.getDocumentById(id);
  if (!doc) throw notFound("document not found");
  const currentVer = doc.currentVersionId
    ? await repo.getVersionById(doc.currentVersionId)
    : null;
  const versionsCount = await repo.countVersions(id);
  return toDocumentDTO(doc, currentVer, versionsCount);
}

export async function listDocuments(caseId, pagination) {
  const { rows, total } = await repo.listDocumentsByCase(caseId, pagination);
  return {
    items: rows.map(({ doc, ver }) => toDocumentSummaryDTO(doc, ver)),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export async function listVersions(documentId) {
  const doc = await repo.getDocumentById(documentId);
  if (!doc) throw notFound("document not found");
  const versions = await repo.listVersions(documentId);
  return { items: versions.map(toVersionDTO) };
}

// Presigned, time-limited download URL for one version — the { url, expiresAt }
// of DESIGN §13.4.
export async function getDownloadUrl(documentId, versionId, { watermark, userId, ip } = {}) {
  const doc = await repo.getDocumentById(documentId);
  if (!doc) throw notFound("document not found");
  const version = await repo.getVersion(documentId, versionId);
  if (!version) throw notFound("version not found");

  // Access event: record who was granted the ability to fetch the bytes. The
  // object fetch itself happens directly against storage via the presigned URL,
  // so this logs issuance, not the byte transfer. Fail-closed — no URL is
  // returned unless the audit entry commits.
  await db.transaction((tx) =>
    recordAudit(tx, {
      actorId: userId,
      action: AuditAction.VERSION_DOWNLOADED,
      targetType: TargetType.VERSION,
      targetId: versionId,
      ip,
      details: {
        documentId,
        versionNo: version.versionNo,
        fileName: version.fileName,
        watermark: !!watermark,
      },
    }),
  );

  // TODO(watermark): DESIGN §12 wants a viewer-name/timestamp watermark on
  // download. Accepted but not yet applied; returns the raw presigned URL.
  return storage.getSignedDownloadUrl(version.storageKey, {
    fileName: version.fileName,
    contentType: version.mimeType,
  });
}

// A single version's metadata (§4: GET /documents/:id/versions/:vid).
export async function getVersion(documentId, versionId) {
  const doc = await repo.getDocumentById(documentId);
  if (!doc) throw notFound("document not found");
  const version = await repo.getVersion(documentId, versionId);
  if (!version) throw notFound("version not found");
  return toVersionDTO(version);
}

// Restore an older version by creating a NEW version whose bytes are copied from
// the source (§4: POST /documents/:id/versions/:vid/restore). The version_no
// trigger bumps the number and the current-pointer trigger moves
// current_version_id to the new row, so the restored content becomes current.
// Returns the updated Document.
export async function restoreVersion({ documentId, sourceVersionId, userId, ip }) {
  const doc = await repo.getDocumentById(documentId);
  if (!doc) throw notFound("document not found");
  if (doc.sealed) throw conflict("document is sealed; no new versions allowed");
  const source = await repo.getVersion(documentId, sourceVersionId);
  if (!source) throw notFound("version not found");

  const newVersionId = randomUUID();
  const storageKey = versionStorageKey({
    caseId: doc.caseId,
    documentId,
    versionId: newVersionId,
  });

  // Content is byte-identical to the source, so we reuse its sha256 rather than
  // re-hashing. Copy the object FIRST, then commit metadata — same
  // store-then-commit / compensating-delete discipline as create & addVersion.
  await storage.copyObject({
    sourceKey: source.storageKey,
    destKey: storageKey,
    contentType: source.mimeType,
    metadata: { sha256: source.sha256 },
  });

  try {
    await db.transaction(async (tx) => {
      const inserted = await repo.insertVersion(tx, {
        id: newVersionId,
        documentId,
        fileName: source.fileName,
        storageKey,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        sha256: source.sha256,
        note: `Restored from version ${source.versionNo}`,
        restoredFromVersionId: source.id,
        createdBy: userId,
        processingStatus: "READY",
      });
      await recordAudit(tx, {
        actorId: userId,
        action: AuditAction.VERSION_RESTORED,
        targetType: TargetType.VERSION,
        targetId: newVersionId,
        ip,
        details: {
          documentId,
          versionNo: inserted.versionNo,
          restoredFromVersionId: source.id,
          restoredFromVersionNo: source.versionNo,
          sha256: source.sha256,
          fileName: source.fileName,
        },
      });
    });
  } catch (err) {
    await storage.deleteObject(storageKey).catch(() => {});
    throw err;
  }

  return getDocument(documentId);
}
