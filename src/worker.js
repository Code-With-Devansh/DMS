import { Worker, UnrecoverableError } from "bullmq";
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
import { storage } from "./storage/index.js";
import { updateDocumentSearchIndex } from "./services/search.service.js";
import {
  createDocumentProcessingProcessor,
  createProcessingFailureHandler,
} from "./jobs/documentProcessing.processor.js";
import { startProcessingReconciler } from "./jobs/documentProcessing.reconcile.js";
import { createRuleBasedScanner } from "./processing/ruleBasedScanner.js";
import { createTesseractOcrClient } from "./processing/ocr/tesseractClient.js";
import { createCloudOcrClient } from "./processing/ocr/cloudOcrClient.js";
import { createFallbackOcrClient } from "./processing/ocr/fallbackOcrClient.js";
import { createExtractor } from "./processing/extract/index.js";
import { normalizeText } from "./processing/normalize.js";
import { createNerPipeline } from "./processing/ner/index.js";
import { createTagger } from "./processing/tagging/index.js";

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

// ── Document-intelligence pipeline worker ────────────────────────────────────
// Consumes src/jobs/documentProcessing.queue.js: scan -> text extraction /
// Tesseract OCR -> NER -> auto-tagging, driving document_versions.processing_status
// to READY (or QUARANTINED/FAILED). The per-stage collaborators (scanner /
// extractText / nerPipeline / tagger) are added incrementally; until wired the
// processor's pass-through defaults apply.
const localOcr = createTesseractOcrClient(config.processing.ocr);
// PROTOTYPE: only escalates to the cloud OCR API if OCR_CLOUD_API_KEY is set
// — unset it to keep OCR fully local, no code change needed.
const ocrClient = config.processing.ocrCloud.apiKey
  ? createFallbackOcrClient({
      primary: localOcr,
      fallback: createCloudOcrClient(config.processing.ocrCloud),
      confidenceThreshold: config.processing.ocrCloud.confidenceThreshold,
    })
  : localOcr;
const { extractText } = createExtractor({
  ocrClient,
  minCharsPerPage: config.processing.ocr.minCharsPerPage,
});

const processingDeps = {
  storage,
  repo,
  db,
  recordAudit,
  AuditAction,
  TargetType,
  updateDocumentSearchIndex,
  maxFileBytes: config.processing.maxFileBytes,
  // PROTOTYPE: rules-only scanning (type/format checks, no malware
  // detection) — see src/processing/ruleBasedScanner.js for exactly what
  // this does and does not close off. To go back to real detection: restore
  // a ClamAV client (removed) or wire up createCloudmersiveScanner, which is
  // still in the tree, before this touches real casework.
  scanner: createRuleBasedScanner(),
  extractText,
  normalizeText,
  nerPipeline: createNerPipeline({ providerIds: config.processing.nerProviders }),
  tagger: createTagger({ stageIds: config.processing.taggingPipeline }),
  UnrecoverableError,
};
const processDocument = createDocumentProcessingProcessor(processingDeps);
const markProcessingFailed = createProcessingFailureHandler(processingDeps);

const processingWorker = new Worker(config.processing.queueName, processDocument, {
  connection,
  concurrency: config.processing.concurrency,
});

processingWorker.on("completed", (job, result) => {
  console.log(
    `[processing] ${job.id} -> ${result?.skipped ? `skipped (${result.skipped})` : `READY (${result?.method}, ${result?.entitiesFound ?? 0} entities)`}`,
  );
});

processingWorker.on("failed", async (job, err) => {
  if (!job) {
    console.error("[processing] job failed with no job handle:", err?.message ?? err);
    return;
  }
  const attemptsMade = job.attemptsMade ?? 0;
  const maxAttempts = job.opts?.attempts ?? config.processing.attempts;
  const unrecoverable = err?.name === "UnrecoverableError";
  const terminal = unrecoverable || attemptsMade >= maxAttempts;
  console.error(err)
  console.error(
    `[processing] failed for ${job.id} (attempt ${attemptsMade}/${maxAttempts})` +
      `${terminal ? " — terminal" : " — will retry"}: ${err?.message ?? err}`,
  );
  if (!terminal) return;
  try {
    await markProcessingFailed(job, err);
  } catch (markErr) {
    console.error(`[processing] could not mark ${job.id} FAILED:`, markErr?.message ?? markErr);
  }
});

processingWorker.on("error", (err) => {
  console.error("[processing] worker error:", err?.message ?? err);
});

const processingReconciler = startProcessingReconciler();

console.log(
  `[processing] worker up on queue ${config.processing.queueName} ` +
    `(concurrency=${config.processing.concurrency}, enabled=${config.processing.enabled})`,
);

console.log(
  `[ledger] worker up on queue ${config.ledger.queueName} ` +
    `(driver=${config.ledger.driver}, concurrency=${config.ledger.concurrency})`,
);

// Graceful shutdown: stop accepting jobs, finish in-flight work, release
// connections. nodemon (dev) and Docker both signal via SIGINT/SIGTERM.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ledger] ${signal} received; draining worker...`);
  try {
    clearInterval(processingReconciler);
    await worker.close();
    await processingWorker.close();
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