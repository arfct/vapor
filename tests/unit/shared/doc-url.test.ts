import { describe, it, expect } from "vitest";
import {
  parseDocumentSegment,
  documentSlug,
  documentPath,
  titleFromMarkdown,
  descriptionFromMarkdown,
  plainText,
} from "~/shared/doc-url";

describe("document path segments", () => {
  it("reads a bare id and a slugged id", () => {
    expect(parseDocumentSegment("26g5wsew")).toEqual({ id: "26g5wsew", slug: null });
    expect(parseDocumentSegment("agent-identity-plan-26g5wsew")).toEqual({ id: "26g5wsew", slug: "agent-identity-plan" });
    expect(parseDocumentSegment("Agent-Identity-26G5WSEW")).toEqual({ id: "26g5wsew", slug: "agent-identity" });
  });

  it("rejects anything whose last hyphenated part is not an eight-character id", () => {
    for (const s of ["hello-world", "new", "abcdefghi", "my-doc-abcdefghi", "-26g5wsew", "a--b-26g5wsew", "26g5wsew.md", ""]) {
      expect(parseDocumentSegment(s), s).toBeNull();
    }
  });
});

describe("documentSlug and documentPath", () => {
  it("slugs a title to ascii words and appends the id", () => {
    expect(documentSlug("Agent identity: hexagons & circles")).toBe("agent-identity-hexagons-circles");
    expect(documentSlug("Café Déjà Vu")).toBe("cafe-deja-vu");
    expect(documentPath("26g5wsew", "Agent identity plan")).toBe("/agent-identity-plan-26g5wsew");
  });

  it("falls back to the bare id without a usable title", () => {
    expect(documentSlug("")).toBeNull();
    expect(documentSlug("!!!")).toBeNull();
    expect(documentSlug("日本語")).toBeNull();
    expect(documentPath("26g5wsew", null)).toBe("/26g5wsew");
    expect(documentPath("26g5wsew", "日本語")).toBe("/26g5wsew");
  });

  it("caps long titles at a word boundary", () => {
    const slug = documentSlug("word ".repeat(30))!;
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.split("-").every((w) => w === "word")).toBe(true);
  });

  it("round-trips through the segment parser", () => {
    const path = documentPath("k3f0a9x2", "Notes from the 9/6 review!");
    expect(parseDocumentSegment(path.slice(1))).toEqual({ id: "k3f0a9x2", slug: "notes-from-the-9-6-review" });
  });
});

describe("title and description from markdown", () => {
  const md = `---
vapor:
  threads: []
---

# Agents are **hexagons**, people are circles

> a quote first

Ping @nicholas-jitkoff~k3f0a9x2 about {--the old--}{++the new++} plan, [details](https://x) inside.

Second paragraph.`;

  it("takes the first h1, with inline syntax removed", () => {
    expect(titleFromMarkdown(md)).toBe("Agents are hexagons, people are circles");
    expect(titleFromMarkdown("no heading here\n\n## only h2")).toBeNull();
    expect(titleFromMarkdown("# ")).toBeNull();
  });

  it("takes the first prose paragraph, skipping quotes, lists, fences, and headings", () => {
    expect(descriptionFromMarkdown(md)).toBe("Ping @nicholas-jitkoff about the new plan, details inside.");
    expect(descriptionFromMarkdown("# Title\n\n```\ncode\n```\n\n- a list\n\nReal text.")).toBe("Real text.");
    expect(descriptionFromMarkdown("# Title only")).toBeNull();
  });

  it("cuts a long description at a word and marks the cut", () => {
    const out = descriptionFromMarkdown(`# T\n\n${"lorem ipsum ".repeat(40)}`, 60)!;
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  it("resolves critic markup as accepted and drops comments", () => {
    expect(plainText("{--a--}{++b++} {==c==}{>>note<<} {~~d~>e~~}")).toBe("b c e");
  });
});
