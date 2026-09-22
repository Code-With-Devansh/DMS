// PROTOTYPE ONLY. Thin client for api4ai's hosted OCR API
// (https://api4ai.cloud/ocr/v1/results), used as a fallback for documents
// Tesseract can't read confidently. This sends the raw document bytes to a
// third party — do not point this at real casework before deciding how that
// squares with the `classification` field on documents (PUBLIC/RESTRICTED/
// CONFIDENTIAL/SECRET). See the gate in src/worker.js for where that decision
// belongs; nothing in this file enforces it.
export function createCloudOcrClient({
  apiKey,
  url = "https://api4ai.cloud/ocr/v1/results",
  timeoutMs = 60_000,
} = {}) {
  async function ocr({ buffer, fileName, mimeType }) {
    if (!apiKey) throw new Error("cloud OCR requested but OCR_CLOUD_API_KEY is not set");

    const form = new FormData();
    form.append("image", new Blob([buffer], { type: mimeType || "application/octet-stream" }), fileName || "upload");

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "X-API-KEY": apiKey },
        body: form,
        signal: ac.signal,
      });
    } catch (err) {
      throw new Error(`cloud OCR request failed: ${err.message}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`cloud OCR request failed: ${res.status} ${body.slice(0, 200)}`);
    }

    const json = await res.json();
    const result = json?.results?.[0];
    if (result?.status?.code && result.status.code !== "ok") {
      throw new Error(`cloud OCR error: ${result.status.message ?? result.status.code}`);
    }

    // Flatten every detected text block into one string, in API order — same
    // shape the rest of the pipeline expects from ocrClient.ocr(). api4ai
    // doesn't return a per-call confidence number; that's fine here because
    // the fallback wrapper decides whether to call this using Tesseract's own
    // confidence, not this result's.
    const blocks = (result?.entities ?? [])
      .filter((e) => e.kind === "objects")
      .flatMap((e) => e.objects ?? [])
      .flatMap((o) => o.entities ?? [])
      .filter((e) => e.kind === "text")
      .map((e) => e.text)
      .filter(Boolean);

    return { text: blocks.join("\n\n"), confidence: null, pageCount: 1 };
  }

  async function ping() {
    return Boolean(apiKey);
  }

  return { ocr, ping };
}
