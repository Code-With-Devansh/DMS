// Thin wrapper around the system `tesseract` CLI (tesseract-ocr) and
// `pdftoppm` (poppler-utils). Replaces the old PaddleOCR sidecar
// (services/ocr/, docker-compose service `ocr`): no separate container, no
// deep-learning model downloads/cache volume, no OpenCV/NumPy/PaddlePaddle
// footprint. tesseract-ocr + poppler-utils together install in the tens of
// MB and each page OCRs in a short-lived subprocess with a small, bounded
// RSS — the combination that actually matters on a low-spec host, where the
// old sidecar alone wanted a multi-hundred-MB-to-multi-GB memory ceiling.
//
// Renders PDFs one page at a time (pdftoppm -f N -l N) rather than the whole
// document up front, for the same reason the old sidecar did: peak memory
// stays ~1 page instead of holding every rendered page in memory at once.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function run(cmd, args, { timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args);
    } catch (err) {
      reject(new Error(`failed to start ${cmd}: ${err.message}`, { cause: err }));
      return;
    }
    let stdout = Buffer.alloc(0);
    let stderr = "";
    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
        }, timeoutMs)
      : null;
    child.stdout.on("data", (d) => {
      stdout = Buffer.concat([stdout, d]);
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`failed to start ${cmd}: ${err.message}`, { cause: err }));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 400) || "(no stderr)"}`));
    });
  });
}

// tesseract's plain stdout mode gives no confidence number. TSV mode gives
// one row per detected word with a 0-100 confidence (-1 for non-text rows),
// which is the only way to reconstruct a mean confidence from the CLI.
function parseTsv(tsvBuffer) {
  const lines = tsvBuffer.toString("utf8").split("\n").filter(Boolean);
  if (lines.length < 2) return { text: "", confs: [] };
  const header = lines[0].split("\t");
  const textIdx = header.indexOf("text");
  const confIdx = header.indexOf("conf");
  const words = [];
  const confs = [];
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const word = (cols[textIdx] ?? "").trim();
    if (!word) continue;
    words.push(word);
    const conf = Number(cols[confIdx]);
    if (!Number.isNaN(conf) && conf >= 0) confs.push(conf / 100);
  }
  return { text: words.join(" "), confs };
}

function meanConfidence(confs) {
  return confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
}

/**
 * @param {{
 *   lang?: string,          // tesseract language code(s), e.g. "eng" or "eng+hin"
 *   timeoutMs?: number,     // per-subprocess-call timeout
 *   dpi?: number,           // pdftoppm rasterization DPI (lower = faster/lighter, blurrier)
 *   maxPages?: number,      // hard cap so a huge/corrupt PDF can't run away
 *   binary?: string,        // override the `tesseract` executable path
 *   pdftoppmBinary?: string,// override the `pdftoppm` executable path
 * }} cfg
 */
export function createTesseractOcrClient({
  lang = "eng",
  timeoutMs = 120_000,
  dpi = 150,
  maxPages = 50,
  binary = "tesseract",
  pdftoppmBinary = "pdftoppm",
} = {}) {
  async function ocrImageBuffer(buffer, dir, name) {
    const imgPath = path.join(dir, name);
    await writeFile(imgPath, buffer);
    const tsv = await run(binary, [imgPath, "stdout", "-l", lang, "tsv"], { timeoutMs });
    return parseTsv(tsv);
  }

  async function ocrPdf(buffer, dir) {
    const pdfPath = path.join(dir, "input.pdf");
    await writeFile(pdfPath, buffer);
    const pageTexts = [];
    const allConfs = [];
    let pageCount = 0;

    for (let page = 1; page <= maxPages; page++) {
      const prefix = path.join(dir, `page-${page}`);
      try {
        await run(
          pdftoppmBinary,
          ["-r", String(dpi), "-f", String(page), "-l", String(page), "-png", pdfPath, prefix],
          { timeoutMs },
        );
      } catch {
        break; // past the last page, or pdftoppm choked — stop rather than fail the job
      }
      const rendered = `${prefix}-1.png`;
      let imgBuf;
      try {
        imgBuf = await readFile(rendered);
      } catch {
        break; // pdftoppm produced nothing for this page number: no more pages
      }
      const { text, confs } = await ocrImageBuffer(imgBuf, dir, `page-${page}.png`);
      pageTexts.push(text);
      allConfs.push(...confs);
      pageCount += 1;
      await rm(rendered, { force: true });
    }

    return { text: pageTexts.filter(Boolean).join("\n\n"), confs: allConfs, pageCount: pageCount || null };
  }

  /**
   * @param {{ buffer: Buffer, fileName: string, mimeType: string }} input
   * @returns {Promise<{ text: string, confidence: number|null, pageCount: number|null }>}
   */
  async function ocr({ buffer, fileName, mimeType }) {
    const dir = await mkdtemp(path.join(tmpdir(), "ocr-"));
    try {
      const isPdf = (mimeType || "").includes("pdf") || /\.pdf$/i.test(fileName || "");
      if (isPdf) {
        const { text, confs, pageCount } = await ocrPdf(buffer, dir);
        return { text, confidence: meanConfidence(confs), pageCount };
      }
      const { text, confs } = await ocrImageBuffer(buffer, dir, fileName || "upload");
      return { text, confidence: meanConfidence(confs), pageCount: 1 };
    } catch (err) {
      const detail = err?.message ?? err;
      throw new Error(`tesseract OCR failed: ${detail}`, { cause: err });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async function ping() {
    try {
      await run(binary, ["--version"], { timeoutMs: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  return { ocr, ping };
}
