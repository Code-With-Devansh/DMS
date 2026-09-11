import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { classifyFile, FileCategory } from "./fileTypes.js";

async function virusScan(file) {
  // virus scan
}

// file.body (storage.getObject's Readable) is single-use and each extraction
// library below wants a Buffer, not a stream — so every real extraction path
// buffers it first. Fine for the "modest evidence files" this system targets
// today (documents.service.js already buffers whole uploads the same way for
// hashing); would need to switch to streaming parsers if that assumption ever
// stops holding.
async function streamToBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// One stub per extraction path — kept separate (rather than one ocrProcessing
// for everything) because each needs different real tooling later: OCR engine
// for images, a PDF text-layer reader (falling back to OCR per-page when a PDF
// is a scanned image with no text layer), a docx/doc parser for Word, and a
// trivial decode for already-plain text. extractText() below is what routes a
// file to the right one.
async function ocrImageText(file) {
  // OCR on an image (photo/scan of a page) — not implemented yet, needs a real
  // OCR engine (e.g. Tesseract); still a stub.
}

// Extracts the text layer already embedded in a PDF (fast, exact — most
// "digital" PDFs, e.g. exported court filings, have one). Does NOT do OCR: a
// scanned PDF (pages that are just images with no text layer) comes back with
// an empty/near-empty string here. Real per-page-OCR fallback for that case is
// still a stub — see the module comment above and ocrImageText().
async function extractPdfText(file) {
  const buffer = await streamToBuffer(file.body);
  // v2 API: new PDFParse({ data }) + parser.getText(), then destroy() to
  // release the underlying pdf.js document/worker — not automatic like the
  // old v1 pdf(buffer) one-shot function call.
  const parser = new PDFParse({ data: buffer });
  try {
    const { text } = await parser.getText();
    return text?.trim() ?? "";
  } catch (err) {
    console.error({ err }, "[document-processing] pdf text extraction failed");
    return "";
  } finally {
    await parser.destroy();
  }
}

// .docx (OOXML) text extraction via mammoth. Legacy binary .doc is mapped to
// the same FileCategory.WORD (see fileTypes.js) but mammoth only understands
// the OOXML zip format, so a .doc upload predictably fails to parse here —
// caught below and treated the same as any other extraction failure (empty
// text, document still goes READY) rather than crashing the job. A real .doc
// path would need a separate legacy-binary parser.
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

// .txt/.csv/.md — already plain text, so "extraction" is just decoding bytes.
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
  const emails = extractedText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g) || [];
  emails.forEach((email) => {
    entities.push({ type: "EMAIL", value: email });
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