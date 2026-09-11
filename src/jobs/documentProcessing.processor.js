import { classifyFile, FileCategory } from "./fileTypes.js";

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
  // PDF text-layer extraction; real implementation should fall back to
  // per-page OCR when the PDF turns out to have no text layer (scanned PDF)
}

async function extractWordText(file) {
  // .doc/.docx text extraction
}

async function extractPlainText(file) {
  // .txt/.csv/.md — already text, just decode the bytes
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
  // ner
}

async function autoTagging(extractedText) {
  // auto-tagging
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