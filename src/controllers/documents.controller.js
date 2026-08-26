import { badRequest } from "../lib/errors.js";
import { authorize } from "../lib/authorize.js";
import { parse } from "../lib/validate.js";
import {
  createDocumentMetadataSchema,
  newVersionMetadataSchema,
  paginationSchema,
  sealSchema,
} from "../validation/documents.schema.js";
import * as service from "../services/documents.service.js";

// The multipart "metadata" field carries a JSON blob; fall back to plain form
// fields if a client sent them directly.
function readMetadata(req) {
  const raw = req.body?.metadata;
  if (typeof raw === "string" && raw.length > 0) {
    try {
      return JSON.parse(raw);
    } catch {
      throw badRequest("metadata must be valid JSON");
    }
  }
  return req.body ?? {};
}

function requireFile(req) {
  if (!req.file) throw badRequest("a file is required (multipart field 'file')");
  return req.file;
}

export async function createDocument(req, res) {
  const { caseId } = req.params;
  await authorize({ user: req.user, action: "document:create", resource: { caseId } });
  const file = requireFile(req);
  const metadata = parse(createDocumentMetadataSchema, readMetadata(req));
  const doc = await service.createDocument({
    caseId,
    userId: req.user.id,
    ip: req.ip,
    file,
    metadata,
  });
  res.status(202).json(doc);
}

export async function addVersion(req, res) {
  const { id } = req.params;
  await authorize({ user: req.user, action: "document:add-version", resource: { documentId: id } });
  const file = requireFile(req);
  const metadata = parse(newVersionMetadataSchema, readMetadata(req));
  const version = await service.addVersion({
    documentId: id,
    userId: req.user.id,
    ip: req.ip,
    file,
    metadata,
  });
  res.status(202).json(version);
}

export async function getDocument(req, res) {
  const { id } = req.params;
  await authorize({ user: req.user, action: "document:read", resource: { documentId: id } });
  res.json(await service.getDocument(id));
}

export async function listDocuments(req, res) {
  const { caseId } = req.params;
  await authorize({ user: req.user, action: "document:list", resource: { caseId } });
  const pagination = parse(paginationSchema, req.query);
  res.json(await service.listDocuments(caseId, pagination));
}

export async function listVersions(req, res) {
  const { id } = req.params;
  await authorize({ user: req.user, action: "document:read", resource: { documentId: id } });
  res.json(await service.listVersions(id));
}

export async function download(req, res) {
  const { id, vid } = req.params;
  await authorize({
    user: req.user,
    action: "document:download",
    resource: { documentId: id, versionId: vid },
  });
  const result = await service.getDownloadUrl(id, vid, {
    watermark: req.query.watermark === "true",
    userId: req.user.id,
    ip: req.ip,
  });
  res.json(result);
}

export async function getVersion(req, res) {
  const { id, vid } = req.params;
  await authorize({
    user: req.user,
    action: "document:read",
    resource: { documentId: id, versionId: vid },
  });
  res.json(await service.getVersion(id, vid));
}

export async function restoreVersion(req, res) {
  const { id, vid } = req.params;
  await authorize({
    user: req.user,
    action: "document:restore",
    resource: { documentId: id, versionId: vid },
  });
  const doc = await service.restoreVersion({
    documentId: id,
    sourceVersionId: vid,
    userId: req.user.id,
    ip: req.ip,
  });
  res.json(doc);
}

// Re-hash the current version's bytes and report the integrity verdict (DESIGN §4).
export async function getIntegrity(req, res) {
  const { id } = req.params;
  await authorize({ user: req.user, action: "document:read", resource: { documentId: id } });
  res.json(await service.verifyIntegrity(id, { userId: req.user.id, ip: req.ip }));
}

// The document's full chain-of-custody trail from the ledger (DESIGN §4).
export async function getCustody(req, res) {
  const { id } = req.params;
  await authorize({ user: req.user, action: "document:read", resource: { documentId: id } });
  res.json(await service.getCustody(id));
}

// Seal a document. The route gates this behind requireAuth + requireStepUp, so
// req.user is the real authenticated caller (not the dev shim) whose step-up token
// was verified for the same subject.
export async function sealDocument(req, res) {
  const { id } = req.params;
  await authorize({ user: req.user, action: "document:seal", resource: { documentId: id } });
  const { reason } = parse(sealSchema, req.body ?? {});
  const doc = await service.sealDocument({
    documentId: id,
    userId: req.user.id,
    ip: req.ip,
    reason,
  });
  res.json(doc);
}
