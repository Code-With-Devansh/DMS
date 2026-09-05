import { Queue } from "bullmq";
import { connection } from "./connection.js";

// Producer side of the post-upload document pipeline (DESIGN §11): virus scan
// -> OCR -> NER -> auto-tagging, driving document_versions.processing_status
// through SCANNING -> OCR -> INDEXING -> READY. Mirrors the shape of
// src/jobs/ledger.queue.js. The consumer lives in
// documentProcessing.processor.js; each stage is currently a stub (see that
// file) so this queue is not yet wired into documents.service.js.
export const documentProcessingQueue = new Queue("document-processing", { connection });

/**
 * Enqueue one processing job for a freshly-uploaded document version.
 *
 * Not yet called from documents.service.js — createDocument/addVersion still
 * set processingStatus straight to "READY". Wiring this in is the first step
 * of actually building out the pipeline stages stubbed in
 * documentProcessing.processor.js.
 *
 * @param {{ versionId: string, documentId: string, caseId: string }} data
 */
export async function enqueueDocumentProcessing(data) {
  return documentProcessingQueue.add("process", data, {
    jobId: data.versionId,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });
}
