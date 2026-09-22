// Runs `primary` (Tesseract) first — there's no way to know a document needs
// the cloud fallback without a local confidence number to check first — and
// only calls `fallback` (the cloud OCR client) when that confidence is below
// threshold, or missing entirely (no words detected at all). Escalation is
// best-effort: if the cloud call itself fails, this returns the local result
// rather than failing the whole processing job.
//
// `engine` on the returned result ("tesseract" | "cloud") is read by
// extract/index.js to set extraction_method, so it's always visible after
// the fact which documents actually had bytes sent to a third party.
export function createFallbackOcrClient({ primary, fallback, confidenceThreshold = 0.6 }) {
  async function ocr(input) {
    const primaryResult = await primary.ocr(input);
    const conf = primaryResult.confidence;
    const shouldEscalate = fallback && (conf == null || conf < confidenceThreshold);

    if (!shouldEscalate) {
      return { ...primaryResult, engine: "tesseract" };
    }

    try {
      const cloudResult = await fallback.ocr(input);
      return { ...cloudResult, engine: "cloud" };
    } catch (err) {
      console.error("[ocr] cloud fallback failed, keeping local result:", err?.message ?? err);
      return { ...primaryResult, engine: "tesseract" };
    }
  }

  async function ping() {
    return primary.ping();
  }

  return { ocr, ping };
}
