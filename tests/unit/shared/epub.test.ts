import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildEpub, readingMarkdown, attachmentImages, epubChapterHtml, epubFilename, printableHtml, READING_CSS } from "~/shared/epub";

const md = `# A plan

Hello {++there++}{--everyone--}, {~~old~>new~~} text {==quoted==}{>>a comment<<}.

\`\`\`agent
Keep it short.
\`\`\`

![diagram](/abcd1234/attachments/abcdefghijklmnop/diagram.png) and ![ext](https://x.example/pic.png)

- item one
`;

describe("EPUB export (#100)", () => {
  it("resolves CriticMarkup as accepted and drops comments and agent fences", () => {
    const text = readingMarkdown(md);
    expect(text).toContain("Hello there, new text quoted.");
    expect(text).not.toContain("everyone");
    expect(text).not.toContain("a comment");
    expect(text).not.toContain("Keep it short");
  });

  it("finds attachment images once each and rewrites them to packaged files in the chapter", () => {
    expect(attachmentImages(md)).toEqual([
      { path: "/abcd1234/attachments/abcdefghijklmnop/diagram.png", id: "abcdefghijklmnop", filename: "diagram.png" },
    ]);
    const html = epubChapterHtml(md, [
      { path: "/abcd1234/attachments/abcdefghijklmnop/diagram.png", bytes: new Uint8Array([1]), contentType: "image/png", filename: "diagram.png" },
    ]);
    expect(html).toContain('src="images/1.png"');
    expect(html).toContain('src="https://x.example/pic.png"');
    expect(html).toContain("<h1>A plan</h1>");
    // XHTML output: void elements are self-closed.
    expect(html).toMatch(/<img [^>]*\/>/);
  });

  it("builds a valid EPUB 3 container with mimetype first and stored", () => {
    const bytes = buildEpub({
      id: "abcd1234",
      markdown: md,
      modified: "2026-09-11T10:00:00.000Z",
      sourceUrl: "https://vapor.example/abcd1234",
      images: [{ path: "/abcd1234/attachments/abcdefghijklmnop/diagram.png", bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png", filename: "diagram.png" }],
    });
    // Zip local header: the first entry's name starts at byte 30 and must be "mimetype", stored (method 0 at byte 8).
    expect(strFromU8(bytes.subarray(30, 38))).toBe("mimetype");
    expect(bytes[8] | (bytes[9] << 8)).toBe(0);

    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      "META-INF/container.xml",
      "OEBPS/chapter.xhtml",
      "OEBPS/content.opf",
      "OEBPS/images/1.png",
      "OEBPS/nav.xhtml",
      "OEBPS/style.css",
      "mimetype",
    ]);
    expect(strFromU8(files.mimetype)).toBe("application/epub+zip");
    const opf = strFromU8(files["OEBPS/content.opf"]);
    expect(opf).toContain("<dc:title>A plan</dc:title>");
    expect(opf).toContain("urn:vapor:abcd1234");
    expect(opf).toContain('<meta property="dcterms:modified">2026-09-11T10:00:00Z</meta>');
    expect(opf).toContain('href="images/1.png" media-type="image/png"');
    expect(opf).toContain("<dc:source>https://vapor.example/abcd1234</dc:source>");
    const chapter = strFromU8(files["OEBPS/chapter.xhtml"]);
    expect(chapter).toContain("Hello there, new text quoted.");
    expect(chapter).toContain('<link rel="stylesheet" type="text/css" href="style.css"/>');
    expect(Array.from(files["OEBPS/images/1.png"])).toEqual([137, 80, 78, 71]);
  });

  it("names the file after the title and id, falling back to the id", () => {
    expect(epubFilename("abcd1234", md)).toBe("a-plan-abcd1234.epub");
    expect(epubFilename("abcd1234", "no heading here")).toBe("abcd1234.epub");
  });

  it("sets the page's type: a sans body, bold sans headings stepping down, a larger lighter title, mono code", () => {
    expect(READING_CSS).toMatch(/body \{ font-family: ui-sans-serif, system-ui/);
    expect(READING_CSS).toContain("h1 { font-size: 1.875em;");
    expect(READING_CSS).toContain("h2 { font-size: 1.5em;");
    expect(READING_CSS).toContain("body > h1:first-child { font-size: 2.5em; font-weight: 500;");
    expect(READING_CSS).toMatch(/code, pre, kbd \{ font-family: "IBM Plex Mono"/);
    expect(READING_CSS).not.toContain("Georgia");
    const files = unzipSync(buildEpub({ id: "abcd1234", markdown: md }));
    expect(strFromU8(files["OEBPS/style.css"])).toBe(READING_CSS);
  });

  it("renders a printable page with the same styles, page rules, and an optional auto-print", () => {
    const html = printableHtml({ id: "abcd1234", markdown: md, origin: "https://vapor.example", autoPrint: true });
    expect(html).toContain("<title>A plan</title>");
    expect(html).toContain("@page { margin: 18mm 16mm; }");
    expect(html).toContain("Hello there, new text quoted.");
    expect(html).not.toContain("Keep it short");
    expect(html).toContain("window.print()");
    expect(html).toContain('src="/abcd1234/attachments/abcdefghijklmnop/diagram.png"');
    expect(printableHtml({ id: "abcd1234", markdown: md, origin: "https://vapor.example", autoPrint: false })).not.toContain("window.print()");
  });
});
