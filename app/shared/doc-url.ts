/**
 * Document URLs carry the title as a readable slug ahead of the id:
 * `/agent-identity-plan-26g5wsew`. The id is what resolves; the slug is
 * for people reading the link and is regenerated from the live title, so
 * a stale slug still opens the document. `/26g5wsew` keeps working.
 */
import { isValidDocumentId } from "./constants";
import { stripMentionIds } from "./agent-protocol";

export const DOCUMENT_SLUG_MAX = 60;

const SEGMENT_RE = /^(?:([a-z0-9]+(?:-[a-z0-9]+)*)-)?([a-z0-9]{8})$/;

/** The id (and any slug) a path segment names, or null when it isn't a document address. */
export function parseDocumentSegment(segment: string): { id: string; slug: string | null } | null {
  const m = SEGMENT_RE.exec(segment.toLowerCase());
  if (!m || !isValidDocumentId(m[2])) return null;
  return { id: m[2], slug: m[1] ?? null };
}

/** A title as a URL slug: ASCII lowercase words joined by hyphens, capped at a word boundary. Null when nothing survives. */
export function documentSlug(title: string | null | undefined): string | null {
  if (!title) return null;
  let slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > DOCUMENT_SLUG_MAX) {
    slug = slug.slice(0, DOCUMENT_SLUG_MAX);
    const cut = slug.lastIndexOf("-");
    slug = (cut > 0 ? slug.slice(0, cut) : slug).replace(/-+$/g, "");
  }
  return slug.length > 0 ? slug : null;
}

/** The path for a document: `/slug-id` when it has a title, else `/id`. */
export function documentPath(id: string, title?: string | null): string {
  const slug = documentSlug(title);
  return slug ? `/${slug}-${id}` : `/${id}`;
}

/**
 * Markdown reduced to readable text for a title or a description:
 * CriticMarkup resolved as if accepted, comments dropped, inline syntax
 * removed, mention ids hidden.
 */
export function plainText(markdown: string): string {
  return stripMentionIds(
    markdown
      .replace(/\{--[\s\S]*?--\}/g, "")
      .replace(/\{>>[\s\S]*?<<\}/g, "")
      .replace(/\{~~[\s\S]*?~>([\s\S]*?)~~\}/g, "$1")
      .replace(/\{\+\+([\s\S]*?)\+\+\}/g, "$1")
      .replace(/\{==([\s\S]*?)==\}/g, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function bodyLines(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
    if (end > 0) start = end + 1;
  }
  return lines.slice(start);
}

/** The first level-one heading, as text; null for an untitled document. */
export function titleFromMarkdown(markdown: string): string | null {
  for (const line of bodyLines(markdown)) {
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      const text = plainText(m[1]);
      return text.length > 0 ? text : null;
    }
  }
  return null;
}

/** The first paragraph after the title, as text, cut to `max` characters for a link preview. */
export function descriptionFromMarkdown(markdown: string, max = 160): string | null {
  let inFence = false;
  for (const raw of bodyLines(markdown)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line.length === 0) continue;
    if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?|\||---|\*\*\*|!\[)/.test(line)) continue;
    const text = plainText(line);
    if (text.length === 0) continue;
    if (text.length <= max) return text;
    const cut = text.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
  }
  return null;
}
