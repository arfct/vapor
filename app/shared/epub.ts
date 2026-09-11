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

const STYLES = `body { font-family: Georgia, serif; line-height: 1.5; margin: 1em; }
h1, h2, h3 { font-family: Helvetica, Arial, sans-serif; line-height: 1.2; }
pre, code { font-family: Menlo, Consolas, monospace; font-size: 0.9em; }
pre { white-space: pre-wrap; }
img { max-width: 100%; height: auto; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #999; color: #555; }
table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 0.25em 0.5em; }
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
    "OEBPS/style.css": [strToU8(STYLES), { level: 6 }],
  };
  images.forEach((image, i) => {
    files[`OEBPS/images/${i + 1}.${imageExtension(image.contentType, image.filename)}`] = [image.bytes, { level: 0 }];
  });
  return zipSync(files);
}
