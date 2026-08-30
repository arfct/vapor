import { isReservedSlug } from "./agent-protocol";

export const APP_NAME = "vapor";

export function isValidDocumentId(id: string): boolean {
  if (id.length !== 8) return false;
  return /^[a-z0-9]+$/.test(id);
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 8;

/**
 * Mints a random document id. Documents live at `/:id`, so the id shares a
 * namespace with the reserved root slugs — a collision is re-rolled rather
 * than returned. Cheap and defensive: no current reserved slug has this
 * shape, but the list is the kind of thing that grows.
 */
export function generateDocumentId(): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < ID_LENGTH; i++) {
      id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    }
    if (!isReservedSlug(id)) return id;
  }
}

export const USER_COLOURS = [
  { color: "#E57373", light: "#FFCDD2" },
  { color: "#81C784", light: "#C8E6C9" },
  { color: "#64B5F6", light: "#BBDEFB" },
  { color: "#FFB74D", light: "#FFE0B2" },
  { color: "#BA68C8", light: "#E1BEE7" },
  { color: "#4DD0E1", light: "#B2EBF2" },
  { color: "#FF8A65", light: "#FFCCBC" },
  { color: "#AED581", light: "#DCEDC8" },
] as const;

/** Document time-to-live in milliseconds (99 hours) */
export const DOCUMENT_TTL_MS = 99 * 60 * 60 * 1000;

/** Document time-to-live in hours (for display) */
export const DOCUMENT_TTL_HOURS = 99;

/**
 * Yjs document format version. Bump when the shared type schema changes
 * (e.g. switching CriticMarkup from plain text to ProseMirror marks).
 *
 * v1: plain text with CriticMarkup delimiters, threads in Y.Map("threads")
 * v2: CriticMarkup stored as ProseMirror marks, threads in Y.Map("threads")
 */
export const DOC_FORMAT_VERSION = 2;

/** Protocol message type: Yjs sync */
export const MSG_SYNC = 0;
/** Protocol message type: Yjs awareness */
export const MSG_AWARENESS = 1;
