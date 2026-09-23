import { fileTypeFromBuffer } from "file-type";

// PROTOTYPE ONLY — replaces ClamAV signature scanning with rules alone.
//
// What this closes: wrong/spoofed file type (magic-byte sniff vs. an
// allow-list, same as clamav.js used to do), and macro-enabled Office
// formats (a real, cheap-to-block attack class).
//
// What this does NOT close: actual malware detection. A well-formed PDF,
// image, or non-macro docx/xlsx carrying an embedded exploit or other
// malicious payload sails straight through every check here. There is no
// signature/heuristic engine in this path at all — that's the trade being
// made, not a hidden gap.
//
// Every result carries scanMethod: "rules_only" (see the scan_method column
// in drizzle/0004_scan_method.sql), so this gap stays visible per-document in
// document_extractions rather than looking identical to a ClamAV-scanned
// document after the fact.
//
// Unlike clamav.js, there's no fail-closed transport step to retry on here —
// no scanning daemon to be unreachable. The only way this returns
// { clean: false } is a disallowed/spoofed type or a blocked macro format,
// never a "couldn't scan it" state.

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

// Macro-enabled Office formats, blocked by filename extension regardless of
// what file-type sniffs the zip container as. Structurally these are the
// same OOXML zip as their macro-free counterparts (the difference is an
// internal vbaProject.bin + a [Content_Types].xml entry), which magic-byte
// sniffing alone doesn't reliably separate across every file-type version —
// the extension check is the robust version of this particular rule.
const MACRO_EXTENSIONS = /\.(docm|dotm|xlsm|xltm|xlsb|pptm|potm|ppsm)$/i;

export function createRuleBasedScanner() {
  /**
   * @param {Buffer} buffer
   * @param {{ declaredMimeType?: string, fileName?: string, versionId?: string }} ctx
   * @returns {Promise<{ clean: boolean, signature: string|null, mimeType: string, scanMethod: "rules_only" }>}
   */
  async function scan(buffer, ctx = {}) {
    const fileName = ctx.fileName || "";
    const declared = (ctx.declaredMimeType || "").toLowerCase();

    if (MACRO_EXTENSIONS.test(fileName)) {
      return {
        clean: false,
        signature: "Rules.MacroEnabledOfficeFormat",
        mimeType: declared || "application/octet-stream",
        scanMethod: "rules_only",
      };
    }

    const sniffed = await fileTypeFromBuffer(buffer);
    const realMime = sniffed?.mime ?? (TEXTUAL_DECLARED.has(declared) ? declared : "application/octet-stream");
    const typeAllowed = sniffed ? ALLOWED_MIME.has(sniffed.mime) : TEXTUAL_DECLARED.has(declared);

    if (!typeAllowed) {
      return {
        clean: false,
        signature: `Pipeline.DisallowedType.${sniffed?.mime ?? declared ?? "unknown"}`,
        mimeType: realMime,
        scanMethod: "rules_only",
      };
    }

    return { clean: true, signature: null, mimeType: realMime, scanMethod: "rules_only" };
  }

  // No external dependency to be unreachable — always "up".
  async function ping() {
    return true;
  }

  return { scan, ping };
}
