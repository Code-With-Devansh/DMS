import { Queue } from "bullmq";
import config from "../config/index.js";
import { connection } from "./connection.js";

// Producer side of the post-upload document pipeline (DESIGN §11): virus scan
// -> OCR -> NER -> auto-tagging, driving document_versions.processing_status
// through SCANNING -> OCR -> INDEXING -> READY. Mirrors the shape of
// src/jobs/ledger.queue.js. The consumer lives in documentProcessing.processor.js;
// each stage is currently a stub (see that file) — the pipeline runs end-to-end,
// it just doesn't do real virus-scan/OCR/NER/tagging work yet.
export const documentProcessingQueue = new Queue(config.documentProcessing.queueName, { connection });

/**
 * Enqueue one processing job for a freshly-uploaded document version.
 *
 * MUST be called AFTER the DB transaction commits, so the worker is guaranteed
 * to find the row. FAIL-OPEN: a Redis/enqueue error is swallowed and logged
 * (same discipline as enqueueLedgerAnchor) — a broker hiccup never fails the
 * upload, the version just stays at whatever processingStatus insertVersion
 * set until a future reconciliation sweep. `jobId = versionId` makes the
 * enqueue idempotent.
 *
 * @param {{ versionId: string, documentId: string, caseId: string, actor: string }} data
 */
export async function enqueueDocumentProcessing(data) {
  if (!config.documentProcessing.enabled) return null;
  try {
    return await documentProcessingQueue.add("process", data, {
      jobId: data.versionId,
      attempts: config.documentProcessing.attempts,
      backoff: { type: "exponential", delay: config.documentProcessing.backoffMs },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  } catch (err) {
    console.error(
      `[document-processing] enqueue failed for version ${data.versionId}; leaving as-is:`,
      err?.message ?? err,
    );
    return null;
  }
}