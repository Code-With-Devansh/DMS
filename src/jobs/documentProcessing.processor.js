import pdfParse from "pdf-parse/lib/pdf-parse.js"; // NOT "pdf-parse" — that package's
  // top-level index.js runs a debug/self-test harness whenever module.parent is
  // unset, which is always true when it's loaded via ESM import(); importing the
  // lib file directly skips that entirely.
import mammoth from "mammoth";
import { classifyFile, FileCategory } from "./fileTypes.js";


async function streamToBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function virusScan(file) {
  // virus scan
}

// One stub per extraction path — kept separate (rather than one ocrProcessing
// for everything) because each needs different real tooling later: OCR engine
// for images, a PDF text-layer reader (falling back to OCR per-page when a PDF
// is a scanned image with no text layer), a docx/doc parser for Word, and a
// trivial decode for already-plain text. All currently no-ops; extractText()
// below is what routes a file to the right one.
async function ocrImageText(file) {
  // OCR on an image (photo/scan of a page)
}

async function extractPdfText(file) {
  const buffer = await streamToBuffer(file.body);
  try {
    const { text } = await pdfParse(buffer);
    return text?.trim() ?? "";
  } catch (err) {
    console.error({ err }, "[document-processing] pdf text extraction failed");
    return "";
  }
}
 

async function extractWordText(file) {
  const buffer = await streamToBuffer(file.body);
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return value?.trim() ?? "";
  } catch (err) {
    console.error({ err }, "[document-processing] word text extraction failed");
    return "";
  }
}
async function extractPlainText(file) {
  const buffer = await streamToBuffer(file.body);
  return buffer.toString("utf8").trim();
}

// Routes a file to the right extraction stub based on its MIME type.
// UNSUPPORTED types (spreadsheets, archives, audio/video, etc.) skip
// extraction entirely and return "" — the document still gets virus-scanned,
// tagged, and indexed on title/description/tags, it just has no extractedText.
async function extractText(file) {
  switch (classifyFile(file.contentType)) {
    case FileCategory.IMAGE:
      return ocrImageText(file);
    case FileCategory.PDF:
      return extractPdfText(file);
    case FileCategory.WORD:
      return extractWordText(file);
    case FileCategory.TEXT:
      return extractPlainText(file);
    case FileCategory.UNSUPPORTED:
    default:
      return "";
  }
}

async function ner(extractedText) {
    const entities = [];

    // Example: detect emails
    const emails = extractedText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [];

    emails.forEach(email => {
        entities.push({
            type: "EMAIL",
            value: email
        });
    });

    return entities;
}


async function autoTagging(extractedText) {
    const tags = [];

    const text = extractedText.toLowerCase();

    if (text.includes("invoice")) tags.push("invoice");
    if (text.includes("contract")) tags.push("contract");
    if (text.includes("payment")) tags.push("payment");
    if (text.includes("employee")) tags.push("hr");
    if (text.includes("confidential")) tags.push("confidential");

    return tags;
}


export function createDocumentProcessingProcessor({
  storage,
  repo,
  db,
  recordAudit,
  AuditAction,
  TargetType,
  indexDocumentVersion,
}) {
  return async function processDocument(job) {
    const { versionId, documentId, caseId, actor } = job.data;
 
    const version = await repo.getVersionById(versionId);
    if (!version) {
      return;
    }
 
    const file = await storage.getObject(version.storageKey);
    // file: { body: Readable, contentType, contentLength, etag }
 
    const scan = await virusScan(file);
    if (scan?.clean === false) {
      throw Object.assign(new Error("virus scan flagged file"), { scan });
    }
 
    await db.transaction((tx) => repo.setProcessingStatus(tx, { versionId, processingStatus: "OCR" }));
    // "OCR" is the DB status name (enum predates this routing), but the stage
    // now covers any text extraction — OCR for images, text-layer reads for
    // PDF/Word/plain text. See extractText()/fileTypes.js for the routing.
    const extractedText = await extractText(file);
 
    await db.transaction((tx) => repo.setProcessingStatus(tx, { versionId, processingStatus: "INDEXING" }));
    const [entities, tags] = await Promise.all([ner(extractedText), autoTagging(extractedText)]);
 
    await db.transaction(async (tx) => {
      await repo.appendDocumentTags(tx, { documentId, tags: tags ?? [] });
      await repo.setProcessingStatus(tx, { versionId, processingStatus: "READY" });
      await recordAudit(tx, {
        actorId: actor,
        action: AuditAction.VERSION_PROCESSED,
        targetType: TargetType.VERSION,
        targetId: versionId,
        ip: null,
        details: { documentId, caseId, tagsAdded: tags ?? [], entities: entities ?? [] },
      });
    });

    // Best-effort: OpenSearch being briefly unavailable shouldn't fail the whole
    // job and re-flip a READY document back to FAILED. A reconciliation sweep
    // (same pattern as the ledger's pending-anchor sweeper) is the right way to
    // catch documents that silently missed indexing — not implemented yet.
    try {
      await indexDocumentVersion({ documentId, versionId, extractedText, entities: entities ?? [], tags: tags ?? [] });
    } catch (err) {
      console.error({ err, documentId, versionId }, "[search] failed to index document, will not retry job");
    }
 
    return { versionId, tagsAdded: tags ?? [], entitiesFound: entities?.length ?? 0 };
  };
}
 
export function createProcessingFailureHandler({ repo, db, recordAudit, AuditAction, TargetType }) {
  return async function markProcessingFailed(job, err) {
    const { versionId, documentId, caseId, actor } = job.data;
    await db.transaction(async (tx) => {
      await repo.setProcessingStatus(tx, { versionId, processingStatus: "FAILED" });
      await recordAudit(tx, {
        actorId: actor,
        action: AuditAction.VERSION_PROCESSING_FAILED,
        targetType: TargetType.VERSION,
        targetId: versionId,
        ip: null,
        details: { documentId, caseId, reason: String(err?.message ?? err) },
      });
    });
  };
}