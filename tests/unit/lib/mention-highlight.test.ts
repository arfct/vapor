import { describe, it, expect } from "vitest";
import { mentionDecorations } from "~/lib/mention-highlight";
import { parseMarkdown } from "~/shared/rich-markdown";

function decorate(md: string, targets: [string, string][]) {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error(parsed.message);
  const set = mentionDecorations(parsed.doc, new Map(targets));
  return set.find().map((d) => ({
    text: parsed.doc.textBetween(d.from, d.to),
    style: (d.spec as { style?: string }).style ?? (d as unknown as { type: { attrs: { style?: string } } }).type.attrs.style,
  }));
}

describe("mention decorations", () => {
  it("colours known slugs and every email mention, skips unknown slugs", () => {
    const out = decorate("hi @scribe, @nobody, and @ada@example.com", [
      ["scribe", "#111"],
      ["ada@example.com", "#222"],
    ]);
    expect(out.map((d) => d.text)).toEqual(["@scribe", "@ada@example.com"]);
    expect(out[0].style).toContain("#111");
    expect(out[1].style).toContain("#222");
  });

  it("draws an unknown email mention without a colour", () => {
    const out = decorate("cc @bob@example.org", []);
    expect(out.map((d) => d.text)).toEqual(["@bob@example.org"]);
    expect(out[0].style).toBeUndefined();
  });

  it("leaves code alone", () => {
    expect(decorate("```\n@scribe\n```", [["scribe", "#111"]])).toEqual([]);
    expect(decorate("run `@scribe` now", [["scribe", "#111"]])).toEqual([]);
  });

  it("does not read an email's local part as an agent", () => {
    const out = decorate("@ada@example.com", [["ada", "#111"]]);
    expect(out.map((d) => d.text)).toEqual(["@ada@example.com"]);
  });
});
