async function virusScan(file) {
  // virus scan
}

async function ocrProcessing(file) {
  // ocr processing
}

async function ner(extractedText) {
  // ner
}

async function autoTagging(extractedText) {
  // auto-tagging
}


export function createDocumentProcessingProcessor({ storage, repo, db, recordAudit, AuditAction, TargetType }) {
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
    const extractedText = await ocrProcessing(file);
 
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