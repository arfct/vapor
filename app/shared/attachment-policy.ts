/**
 * Attachment policy: sizes, types, names, addresses, and budgets. Pure, so
 * the Worker upload route, the DocumentAgent, the Registry ledger, the MCP
 * tool, and the editor share one source of truth and every rule is testable
 * without R2 or a Durable Object. Decisions recorded in
 * docs/plans/2026-09-05-attachments-plan.md.
 */

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_DOC_BYTES = 100 * 1024 * 1024;
export const MAX_FILES_PER_DOC = 100;
export const PRINCIPAL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PRINCIPAL_WINDOW_BYTES = 500 * 1024 * 1024;
export const PRINCIPAL_WINDOW_UPLOADS = 200;
/** Decoded size of an `attach` tool payload; base64 inflates it to ~5.5 MB of JSON. */
export const AGENT_TOOL_MAX_BYTES = 4 * 1024 * 1024;
/** A reservation older than this was abandoned; its bytes go back to the budget. */
export const RESERVATION_TTL_MS = 5 * 60 * 1000;

export type AttachmentKind = "image" | "file";

export type AttachmentError =
  | "attachment_too_large"
  | "attachment_budget"
  | "principal_budget"
  | "attachment_type"
  | "attachment_not_found"
  | "doc_not_found"
  | "length_required"
  | "sign_in_required"
  | "capability_denied";

/** Content types by extension; the allowlist. Anything else is refused. */
const TYPES_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);
/** Zip containers: plain zips and the office formats built on them. */
const ZIP_TYPES = new Set([
  "application/zip",
  TYPES_BY_EXTENSION.docx,
  TYPES_BY_EXTENSION.xlsx,
  TYPES_BY_EXTENSION.pptx,
]);
const LEGACY_OFFICE_TYPES = new Set([TYPES_BY_EXTENSION.doc, TYPES_BY_EXTENSION.xls, TYPES_BY_EXTENSION.ppt]);

/** For a file picker's `accept`: every allowed extension. */
export const ACCEPTED_FILE_TYPES = Object.keys(TYPES_BY_EXTENSION)
  .map((ext) => `.${ext}`)
  .join(",");

export function isImageType(contentType: string): boolean {
  return IMAGE_TYPES.has(contentType);
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot + 1).toLowerCase();
}

/** The allowed content type for a filename, or null when the extension is refused. */
export function typeForFilename(filename: string): string | null {
  return TYPES_BY_EXTENSION[extensionOf(filename)] ?? null;
}

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  sig.every((b, i) => bytes[offset + i] === b);

/** The image or container type the leading bytes declare, if any. */
function sniffMagic(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return "application/zip";
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return "application/x-ole"; // legacy office
  return null;
}

/**
 * The content type the server will store and serve, from the filename's
 * extension checked against the leading bytes; never from the client's
 * claim. Images must carry their own magic; text types must not contain
 * NUL bytes; zip-based types must start as a zip. Null means refused.
 */
export function sniffContentType(filename: string, head: Uint8Array): string | null {
  const declared = typeForFilename(filename);
  if (!declared) return null;
  const magic = sniffMagic(head);
  if (IMAGE_TYPES.has(declared)) return magic === declared ? declared : null;
  if (declared === "application/pdf") return magic === "application/pdf" ? declared : null;
  if (ZIP_TYPES.has(declared)) return magic === "application/zip" ? declared : null;
  if (LEGACY_OFFICE_TYPES.has(declared)) {
    return magic === "application/x-ole" || magic === "application/zip" ? declared : null;
  }
  if (TEXT_TYPES.has(declared)) {
    for (let i = 0; i < Math.min(head.length, 8192); i++) if (head[i] === 0) return null;
    return magic === null ? declared : null;
  }
  return null;
}

/** A filename safe in a URL path and a Content-Disposition header. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\p{Cc}"<>|:*?%#]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "file";
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const ATTACHMENT_ID_RE = /^[a-z2-7]{16}$/;

export function mintAttachmentId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ID_ALPHABET[b % 32];
  return out;
}

export function attachmentPath(docId: string, id: string, filename: string): string {
  return `/${docId}/attachments/${id}/${encodeURIComponent(filename)}`;
}

const PATH_RE = /^\/([a-z0-9]{8})\/attachments\/([a-z2-7]{16})\/([^/?#]+)$/;

/**
 * Whether a markdown URL points at an attachment: a relative path, or an
 * absolute URL on any origin (exports rewrite paths to absolute URLs, and
 * an upload should round-trip them back). Returns the path form to store.
 */
export function parseAttachmentUrl(
  url: string,
): { docId: string; id: string; filename: string; path: string } | null {
  let path = url;
  if (/^https?:\/\//i.test(url)) {
    try {
      path = new URL(url).pathname;
    } catch {
      return null;
    }
  }
  const m = PATH_RE.exec(path);
  if (!m) return null;
  let filename: string;
  try {
    filename = decodeURIComponent(m[3]);
  } catch {
    return null;
  }
  return { docId: m[1], id: m[2], filename, path };
}

/** Rewrite relative attachment paths in markdown to absolute URLs on `origin`. */
export function absolutizeAttachmentUrls(markdown: string, origin: string): string {
  return markdown.replace(/\]\((\/[a-z0-9]{8}\/attachments\/[a-z2-7]{16}\/[^)\s]+)\)/g, `](${origin}$1)`);
}

export function budgetAllows(
  current: { readyBytes: number; reservedBytes: number; count: number },
  bytes: number,
): AttachmentError | null {
  if (bytes > MAX_FILE_BYTES) return "attachment_too_large";
  if (current.count >= MAX_FILES_PER_DOC) return "attachment_budget";
  if (current.readyBytes + current.reservedBytes + bytes > MAX_DOC_BYTES) return "attachment_budget";
  return null;
}

export interface LedgerRow {
  created_at: number;
  bytes: number;
}

/** Rows still inside the rolling window. */
export function pruneLedger(rows: LedgerRow[], now: number): LedgerRow[] {
  return rows.filter((r) => now - r.created_at < PRINCIPAL_WINDOW_MS);
}

export function ledgerAllows(rows: LedgerRow[], bytes: number, now: number): AttachmentError | null {
  const live = pruneLedger(rows, now);
  if (live.length >= PRINCIPAL_WINDOW_UPLOADS) return "principal_budget";
  const used = live.reduce((sum, r) => sum + r.bytes, 0);
  return used + bytes > PRINCIPAL_WINDOW_BYTES ? "principal_budget" : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
