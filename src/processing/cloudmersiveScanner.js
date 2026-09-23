import { fileTypeFromBuffer } from "file-type";

// PROTOTYPE ONLY — swaps the local ClamAV daemon (processing/clamav.js) for
// Cloudmersive's hosted Virus Scan API. Cuts the ~300-500MB clamd resident
// signature-database footprint at the cost of a network call per upload AND
// sending the raw file bytes to a third party — do not point this at real
// casework without the same classification-gate discussion as the cloud OCR
// fallback (src/processing/ocr/cloudOcrClient.js). Nothing in this file
// enforces that; it's a straight swap for low-spec prototyping.
//
// Same fail-closed contract as clamav.js's scan(): throws on any
// transport/protocol error (job retries), only returns { clean: false } for a
// genuine detection or a disallowed file type. Type-sniff allow-list is
// copied from clamav.js rather than shared, so this file can be deleted
// outright when the prototype phase is over without touching the ClamAV path.

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/msword",
  "application/vnd.ms-excel",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/bmp",
  "image/webp",
]);

const TEXTUAL_DECLARED = new Set(["text/plain", "text/csv", "application/csv", "text/markdown"]);

/**
 * @param {{ apiKey: string, url?: string, timeoutMs?: number }} cfg
 */
export function createCloudmersiveScanner({
  apiKey,
  url = "https://api.cloudmersive.com/virus/scan/file",
  timeoutMs = 30_000,
} = {}) {
  /**
   * @param {Buffer} buffer
   * @param {{ declaredMimeType?: string, fileName?: string, versionId?: string }} ctx
   * @returns {Promise<{ clean: boolean, signature: string|null, mimeType: string }>}
   */
  async function scan(buffer, ctx = {}) {
    // 1. Type sniff first, exactly as clamav.js does — cheap, local, and a
    // mismatch is itself a quarantine reason regardless of scan engine.
    const sniffed = await fileTypeFromBuffer(buffer);
    const declared = (ctx.declaredMimeType || "").toLowerCase();
    const realMime = sniffed?.mime ?? (TEXTUAL_DECLARED.has(declared) ? declared : "application/octet-stream");

    const typeAllowed = sniffed ? ALLOWED_MIME.has(sniffed.mime) : TEXTUAL_DECLARED.has(declared);

    if (!typeAllowed) {
      return {
        clean: false,
        signature: `Pipeline.DisallowedType.${sniffed?.mime ?? declared ?? "unknown"}`,
        mimeType: realMime,
        scanMethod: "cloudmersive",
      };
    }

    if (!apiKey) throw new Error("Cloudmersive scan requested but CLOUDMERSIVE_API_KEY is not set");

    // 2. Cloudmersive. Any transport/protocol failure throws -> job retries
    // (fail-closed, same as the clamd path).
    const form = new FormData();
    form.append("inputFile", new Blob([buffer], { type: realMime }), ctx.fileName || "upload");

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Apikey: apiKey },
        body: form,
        signal: ac.signal,
      });
    } catch (err) {
      throw new Error(`Cloudmersive request failed: ${err.message}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cloudmersive scan ${res.status}: ${body.slice(0, 200)}`);
    }

    // { CleanResult: bool, FoundViruses: [{ FileName, VirusName }, ...] | null }
    const json = await res.json();
    if (json.CleanResult === true) {
      return { clean: true, signature: null, mimeType: realMime, scanMethod: "cloudmersive" };
    }
    const names = (json.FoundViruses ?? []).map((v) => v.VirusName).filter(Boolean);
    return { clean: false, signature: names[0] ?? "Cloudmersive.Detected", mimeType: realMime, scanMethod: "cloudmersive" };
  }

  // Reachability probe for logging/health. Cloudmersive has no documented
  // cheap ping endpoint; "configured" is as good a signal as this gets for a
  // prototype. Real reachability is proven by the next scan() call.
  async function ping() {
    return Boolean(apiKey);
  }

  return { scan, ping };
}
