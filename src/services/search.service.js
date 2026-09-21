import { db } from "../db/index.js";
import * as repo from "../repositories/documents.repo.js";
import { authorize } from "../lib/authorize.js";

// ── search index maintenance (called from documentProcessing.processor.js) ────
//
// documents.extracted_text / documents.entities are a denormalized cache of
// the CURRENT version's OCR/NER output (see the comment on those columns in
// src/db/schema/documents.js). "Indexing" is now just an UPDATE on the
// documents row — search_vector (drizzle/0003_search_fts.sql) is maintained
// by a BEFORE INSERT/UPDATE trigger, so Postgres recomputes it as part of
// this same statement. No separate index/cluster to write to or keep in sync.
//
// tags are NOT written here: appendDocumentTags() already merged them into
// documents.tags earlier in the same job (documentProcessing.processor.js),
// and that UPDATE already refreshed the tags portion of search_vector. This
// function only owns the extraction-derived columns.
export async function updateDocumentSearchIndex({ documentId, extractedText = "", entities = [] }) {
  // The old OpenSearch mapping's `entities` field was a flat list of
  // matchable strings, not the richer { type, value } shape ner() returns for
  // the audit log. Flatten the same way here; accept bare strings too so this
  // doesn't break if a caller ever passes those directly.
  const entityValues = Array.from(
    new Set(entities.map((e) => (typeof e === "string" ? e : e?.value)).filter(Boolean)),
  );

  await repo.updateDocumentSearchText(db, { documentId, extractedText, entities: entityValues });
}

// Soft-delete and hard document lifecycle changes both flow through here (not
// wired up yet — see the note in documents.service.js's delete path / the
// follow-up PR). Clearing extracted_text/entities is defense-in-depth on top
// of the deletedAt filter searchDocumentCandidates() already applies: a
// deleted document's OCR text stops sitting in a searchable column instead of
// relying solely on the WHERE clause to keep it out of results.
export async function clearDocumentSearchIndex(documentId) {
  await repo.clearDocumentSearchText(db, { documentId });
}

// ── search ──────────────────────────────────────────────────────────────────
//
// Two-phase authorization, deliberately NOT baked into the search query:
//   1. searchDocumentCandidates() returns ranked CANDIDATE documentIds — it
//      knows nothing about who's asking.
//   2. Each candidate is re-checked with the exact same authorize() /
//      canAccessCase() path every other document read goes through
//      (src/lib/authorize.js), so search can never surface — even in a
//      "found 1 result" sense — a document the same user couldn't open via
//      GET /documents/:id. One enforcement point, not two ABAC implementations
//      to keep in sync.
//
// Trade-off: because filtering happens after the SQL query, a page can come
// back short (or empty) even though more authorized matches exist further
// into the ranking. We over-fetch (SEARCH_MULTIPLIER) to absorb the common
// case; it's not a correctness guarantee at scale. If this ever shows up as
// "page 2 feels wrong" in practice, the fix is pushing the authorization
// boundary (jurisdiction / allowed-viewer set) into the WHERE clause itself —
// bigger change, deliberately deferred until proven necessary. Same
// trade-off the old OpenSearch version made, for the same reason.
const SEARCH_MULTIPLIER = 3;

export async function searchDocuments({ user, q, caseId, docType, classification, tags, page = 1, pageSize = 20 }) {
  const candidateSize = pageSize * SEARCH_MULTIPLIER;
  const hits = await repo.searchDocumentCandidates({
    q,
    caseId,
    docType,
    classification,
    tags,
    limit: candidateSize,
  });

  // Re-check access per candidate, in parallel, using the real authorize() path.
  const checks = await Promise.allSettled(
    hits.map((hit) => authorize({ user, action: "document:read", resource: { documentId: hit.id } })),
  );

  const authorized = hits.filter((_, i) => checks[i].status === "fulfilled");
  const total = authorized.length; // approximate — see module doc comment above
  const pageHits = authorized.slice((page - 1) * pageSize, page * pageSize);

  return {
    total,
    page,
    pageSize,
    results: pageHits.map((hit) => ({
      documentId: hit.id,
      title: hit.title,
      docType: hit.docType,
      classification: hit.classification,
      tags: hit.tags,
      caseId: hit.caseId,
      score: Number(hit.rank),
    })),
  };
}
