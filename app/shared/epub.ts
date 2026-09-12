import MarkdownIt from "markdown-it";
import { zipSync, strToU8 } from "fflate";
import { stripMentionIds } from "./agent-protocol";
import { parseAttachmentUrl } from "./attachment-policy";
import { titleFromMarkdown } from "./doc-url";

/**
 * EPUB export (#100). A vapor document as a single-chapter EPUB 3 that
 * Kindle (via Send to Kindle) and reMarkable both open. Pure: takes the
 * markdown and any attachment bytes, returns the zip. The Worker route
 * fetches attachments from R2; the browser gets the file from /:id.epub.
 */

export interface EpubImage {
  /** The attachment path as it appears in the markdown (`/doc/attachments/id/name`). */
  path: string;
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

export interface EpubInput {
  id: string;
  markdown: string;
  images?: EpubImage[];
  /** ISO time for dcterms:modified; defaults to now. */
  modified?: string;
  /** Where the document lives, for the source link in the package. */
  sourceUrl?: string;
}

/**
 * CriticMarkup resolved as if every change were accepted, comments and
 * agent-instruction fences removed, mention ids hidden — what a reader
 * would want on a device, and the same treatment titles get.
 */
export function readingMarkdown(markdown: string): string {
  return stripMentionIds(
    markdown
      .replace(/^```agent[^\n]*\n[\s\S]*?\n```[ \t]*$/gm, "")
      .replace(/\{--[\s\S]*?--\}/g, "")
      .replace(/\{>>[\s\S]*?<<\}/g, "")
      .replace(/\{~~[\s\S]*?~>([\s\S]*?)~~\}/g, "$1")
      .replace(/\{\+\+([\s\S]*?)\+\+\}/g, "$1")
      .replace(/\{==([\s\S]*?)==\}/g, "$1"),
  );
}

/** The attachment images a document refers to, in order, once each. */
export function attachmentImages(markdown: string): { path: string; id: string; filename: string }[] {
  const out: { path: string; id: string; filename: string }[] = [];
  const seen = new Set<string>();
  for (const m of markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const parsed = parseAttachmentUrl(m[1]);
    if (!parsed || seen.has(parsed.path)) continue;
    seen.add(parsed.path);
    out.push({ path: parsed.path, id: parsed.id, filename: parsed.filename });
  }
  return out;
}

const md = new MarkdownIt({ html: false, linkify: true, xhtmlOut: true });

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function imageExtension(contentType: string, filename: string): string {
  const byType: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return byType[contentType] ?? (filename.split(".").pop()?.toLowerCase() || "bin");
}

/** The chapter body as XHTML, with attachment image URLs pointed at the packaged files. */
export function epubChapterHtml(markdown: string, images: EpubImage[]): string {
  let source = readingMarkdown(markdown);
  images.forEach((image, i) => {
    const local = `images/${i + 1}.${imageExtension(image.contentType, image.filename)}`;
    source = source.split(image.path).join(local);
    // Exports may carry the absolute form of the same path.
    source = source.replace(new RegExp(`https?://[^/\\s)]+${image.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"), local);
  });
  return md.render(source);
}

/**
 * The document's type as the page sets it (docs/design-system.md, app.css
 * `.tiptap`): a system sans body at 1.6 leading, bold sans headings stepping
 * 1.875 / 1.5 / 1.25 em with a lighter, larger opening title, IBM Plex Mono
 * (or the reader's mono) for code, a rule-left blockquote, ruled tables.
 * Relative units throughout so Kindle's and reMarkable's own text size
 * settings still apply. Shared with the print view, which adds page rules.
 */
export const READING_CSS = `body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 1em; line-height: 1.6; color: #1a1a1a; margin: 0 auto; padding: 1.5em; max-width: 42em; }
p { margin: 0 0 0.6em; }
h1, h2, h3, h4 { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-weight: bold; line-height: 1.2; }
h1 { font-size: 1.875em; margin: 1.5em 0 0.6em; }
h2 { font-size: 1.5em; line-height: 1.3; margin: 1.25em 0 0.5em; }
h3, h4 { font-size: 1.25em; line-height: 1.3; margin: 1em 0 0.4em; }
body > h1:first-child { font-size: 2.5em; font-weight: 500; line-height: 1.1; margin-top: 0; }
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
ul, ol { margin: 0 0 0.6em 1.5em; padding: 0; }
li { margin-bottom: 0.25em; }
li > p { margin-bottom: 0; }
blockquote { margin: 0 0 1em; padding: 0 0 0 1em; border-left: 4px solid #d9d9d9; color: #555; font-style: italic; }
code, pre, kbd { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.875em; }
code { background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px; }
pre { background: #f2f2f2; padding: 0.75em 1em; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; margin: 0 0 0.75em; }
pre code { background: none; padding: 0; }
a { color: inherit; text-decoration: underline; text-decoration-color: #999; }
hr { border: 0; border-top: 1px solid #d9d9d9; margin: 1.5em 0; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; margin: 0 0 0.75em; font-size: 0.95em; }
th, td { border: 1px solid #d9d9d9; padding: 0.3em 0.6em; text-align: left; vertical-align: top; }
th { font-weight: bold; background: #f7f7f7; }
del { color: #999; }
`;

/** The file name a reader will see: the title's slug and the id. */
export function epubFilename(id: string, markdown: string): string {
  const title = titleFromMarkdown(markdown);
  const slug = title
    ? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
    : "";
  return `${slug ? `${slug}-` : ""}${id}.epub`;
}

/** Builds the EPUB bytes. */
export function buildEpub(input: EpubInput): Uint8Array {
  const images = input.images ?? [];
  const title = titleFromMarkdown(input.markdown) ?? `vapor ${input.id}`;
  const modified = (input.modified ?? new Date().toISOString()).replace(/\.\d{3}Z$/, "Z");
  const body = epubChapterHtml(input.markdown, images);

  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}</body>
</html>
`;

  const imageItems = images
    .map((image, i) => {
      const ext = imageExtension(image.contentType, image.filename);
      return `    <item id="img${i + 1}" href="images/${i + 1}.${ext}" media-type="${escapeXml(image.contentType)}"/>`;
    })
    .join("\n");

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:vapor:${escapeXml(input.id)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>vapor</dc:creator>${input.sourceUrl ? `\n    <dc:source>${escapeXml(input.sourceUrl)}</dc:source>` : ""}
    <meta property="dcterms:modified">${escapeXml(modified)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
${imageItems}
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>
`;

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="chapter.xhtml">${escapeXml(title)}</a></li></ol></nav></body>
</html>
`;

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    // The spec wants `mimetype` first and stored, not deflated.
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": [strToU8(container), { level: 6 }],
    "OEBPS/content.opf": [strToU8(opf), { level: 6 }],
    "OEBPS/nav.xhtml": [strToU8(nav), { level: 6 }],
    "OEBPS/chapter.xhtml": [strToU8(chapter), { level: 6 }],
    "OEBPS/style.css": [strToU8(READING_CSS), { level: 6 }],
  };
  images.forEach((image, i) => {
    files[`OEBPS/images/${i + 1}.${imageExtension(image.contentType, image.filename)}`] = [image.bytes, { level: 0 }];
  });
  return zipSync(files);
}

/**
 * The document as a standalone HTML page for printing or saving as a PDF
 * (#100): the same reading stylesheet as the EPUB plus page rules, and the
 * browser's print dialog when opened with `?print=1`. Attachment URLs are
 * left as the same-origin paths they already are.
 */
export function printableHtml(input: { id: string; markdown: string; origin: string; autoPrint: boolean }): string {
  const title = titleFromMarkdown(input.markdown) ?? `vapor ${input.id}`;
  const body = md.render(readingMarkdown(input.markdown));
  const escaped = escapeXml(title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escaped}</title>
<style>
${READING_CSS}
@page { margin: 18mm 16mm; }
@media print {
  body { padding: 0; max-width: none; color: #000; }
  a { text-decoration: none; color: inherit; }
  pre, blockquote, table, img { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  .print-note { display: none; }
}
.print-note { font-size: 0.85em; color: #777; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.75em; margin-bottom: 1.5em; }
.print-note a { color: inherit; }
</style>
</head>
<body>
<p class="print-note">Print, or choose “Save as PDF” in the print dialog. Source: <a href="${escapeXml(input.origin)}/${escapeXml(input.id)}">${escapeXml(input.origin)}/${escapeXml(input.id)}</a></p>
${body}${input.autoPrint ? `
<script>window.addEventListener("load", () => setTimeout(() => window.print(), 150));</script>` : ""}
</body>
</html>
`;
}
