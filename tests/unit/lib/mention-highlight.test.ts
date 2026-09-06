import { describe, it, expect } from "vitest";
import { mentionDecorations } from "~/lib/mention-highlight";
import { parseMarkdown } from "~/shared/rich-markdown";

function decorate(md: string, targets: [string, string][]) {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error(parsed.message);
  const set = mentionDecorations(parsed.doc, new Map(targets.map(([handle, color]) => [handle, { color, label: handle }])));
  return set.find().map((d) => ({
    text: parsed.doc.textBetween(d.from, d.to),
    style: (d.spec as { style?: string }).style ?? (d as unknown as { type: { attrs: { style?: string } } }).type.attrs.style,
  }));
}

describe("mention decorations", () => {
  it("colours known legacy slugs and skips unknown ones and addresses", () => {
    const out = decorate("hi @scribe, @nobody, and @ada@example.com", [
      ["scribe", "#111"],
      ["ada@example.com", "#222"],
    ]);
    expect(out.map((d) => d.text)).toEqual(["@scribe"]);
    expect(out[0].style).toContain("#111");
  });

  it("leaves token mentions to the mention node", () => {
    const parsed = parseMarkdown("ping @scribe~c41d7e90 now");
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.doc.firstChild?.childCount).toBe(3);
    expect(parsed.doc.firstChild?.child(1).type.name).toBe("mention");
    expect(mentionDecorations(parsed.doc, new Map([["scribe", { color: "#111", label: "Scribe" }]])).find()).toEqual([]);
  });

  it("leaves code alone", () => {
    expect(decorate("```\n@scribe\n```", [["scribe", "#111"]])).toEqual([]);
    expect(decorate("run `@scribe` now", [["scribe", "#111"]])).toEqual([]);
  });

  it("does not read an email's local part as an agent", () => {
    const out = decorate("@ada@example.com", [["ada", "#111"]]);
    expect(out).toEqual([]);
  });
});
