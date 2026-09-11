import { Worker } from "bullmq";
import config from "./config/index.js";
import { connection } from "./jobs/connection.js";
import { mentionNotificationWorker } from "./workers/notifications.worker.js";
import { db } from "./db/index.js";
import { ledger } from "./ledger/index.js";
import * as repo from "./repositories/documents.repo.js";
import { recordAudit, AuditAction, TargetType } from "./audit/index.js";
import {
  createLedgerAnchorProcessor,
  createAnchorFailureHandler,
} from "./jobs/ledgerAnchor.processor.js";
import {
  createDocumentProcessingProcessor,
  createProcessingFailureHandler,
} from "./jobs/documentProcessing.processor.js";
import { indexDocumentVersion } from "./services/search.service.js";
import { ensureDocumentsIndex } from "./search/documents.index.js";
import { storage } from "./storage/index.js";

// Ledger-anchoring worker process. Consumes the jobs enqueued by
// src/jobs/ledger.queue.js (enqueueLedgerAnchor) and drives each version's
// ledger_status from PENDING_LEDGER to ANCHORED (or FAILED after retries).
// Runs as its own container (DMS-worker) so slow/unreachable ledger calls never
// touch the API request path.

const deps = { ledger, repo, db, recordAudit, AuditAction, TargetType };
const processLedgerAnchor = createLedgerAnchorProcessor(deps);
const markAnchorFailed = createAnchorFailureHandler(deps);

const worker = new Worker(config.ledger.queueName, processLedgerAnchor, {
  connection,
  concurrency: config.ledger.concurrency,
});

worker.on("completed", (job, result) => {
  console.log(`[ledger] anchored ${job.id} -> ${result?.txId ?? "?"}`);
});

// BullMQ fires "failed" on every failed attempt. We only give up (and mark the
// row FAILED) once attempts are exhausted; earlier failures just wait for the
// next backoff retry.
worker.on("failed", async (job, err) => {
  if (!job) {
    console.error("[ledger] job failed with no job handle:", err?.message ?? err);
    return;
  }
  const attemptsMade = job.attemptsMade ?? 0;
  const maxAttempts = job.opts?.attempts ?? config.ledger.attempts;
  const terminal = attemptsMade >= maxAttempts;
  console.error(
    `[ledger] anchor failed for ${job.id} (attempt ${attemptsMade}/${maxAttempts})` +
      `${terminal ? " — giving up, marking FAILED" : " — will retry"}: ${err?.message ?? err}`,
  );
  if (!terminal) return;
  try {
    await markAnchorFailed(job, err);
  } catch (markErr) {
    // The row stays PENDING_LEDGER for reconciliation; log loudly.
    console.error(`[ledger] could not mark ${job.id} FAILED:`, markErr?.message ?? markErr);
  }
});

worker.on("error", (err) => {
  console.error("[ledger] worker error:", err?.message ?? err);
});

console.log(
  `[ledger] worker up on queue ${config.ledger.queueName} ` +
    `(driver=${config.ledger.driver}, concurrency=${config.ledger.concurrency})`,
);

// Document-processing worker. Consumes the jobs enqueued by
// src/jobs/documentProcessing.queue.js (enqueueDocumentProcessing) and drives
// each version's processingStatus from SCANNING -> OCR -> INDEXING -> READY
// (or FAILED after retries), then indexes the result into OpenSearch. The
// virus-scan/OCR/NER/auto-tag stages inside the processor are still stubs
// (see documentProcessing.processor.js) — this wires the pipeline shape up
// end-to-end so search has real (if currently empty) extractedText/entities
// to work against.
const documentProcessingDeps = { storage, repo, db, recordAudit, AuditAction, TargetType, indexDocumentVersion };
const processDocument = createDocumentProcessingProcessor(documentProcessingDeps);
const markProcessingFailed = createProcessingFailureHandler(documentProcessingDeps);

let documentProcessingWorker;
if (config.documentProcessing.enabled) {
  // Idempotent — creates the OpenSearch index on first boot, no-ops after.
  // Awaited here (top-level await) before the worker starts pulling jobs, so
  // the very first processed document has somewhere to be indexed into.
  await ensureDocumentsIndex();

  documentProcessingWorker = new Worker(config.documentProcessing.queueName, processDocument, {
    connection,
    concurrency: config.documentProcessing.concurrency,
  });

  documentProcessingWorker.on("completed", (job) => {
    console.log(`[document-processing] processed version ${job.id}`);
  });

  // Same "only give up once attempts are exhausted" discipline as the ledger
  // worker above.
  documentProcessingWorker.on("failed", async (job, err) => {
    if (!job) {
      console.error("[document-processing] job failed with no job handle:", err?.message ?? err);
      return;
    }
    const attemptsMade = job.attemptsMade ?? 0;
    const maxAttempts = job.opts?.attempts ?? config.documentProcessing.attempts;
    const terminal = attemptsMade >= maxAttempts;
    console.error(
      `[document-processing] processing failed for ${job.id} (attempt ${attemptsMade}/${maxAttempts})` +
        `${terminal ? " — giving up, marking FAILED" : " — will retry"}: ${err?.message ?? err}`,
    );
    if (!terminal) return;
    try {
      await markProcessingFailed(job, err);
    } catch (markErr) {
      console.error(`[document-processing] could not mark ${job.id} FAILED:`, markErr?.message ?? markErr);
    }
  });

  documentProcessingWorker.on("error", (err) => {
    console.error("[document-processing] worker error:", err?.message ?? err);
  });

  console.log(
    `[document-processing] worker up on queue ${config.documentProcessing.queueName} ` +
      `(concurrency=${config.documentProcessing.concurrency})`,
  );
} else {
  console.log("[document-processing] disabled (DOCUMENT_PROCESSING_ENABLED=false); worker not started");
}

// Graceful shutdown: stop accepting jobs, finish in-flight work, release
// connections. nodemon (dev) and Docker both signal via SIGINT/SIGTERM.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ledger] ${signal} received; draining worker...`);
  try {
    await worker.close();
    await documentProcessingWorker?.close();
    await mentionNotificationWorker.close();
    await ledger.close?.();
  } catch (err) {
    console.error("[ledger] error during shutdown:", err?.message ?? err);
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));