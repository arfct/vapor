import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { getBlocks, yDocToMarkdown, resolveAnchor, insertMarkdownBlocks, deleteBlocks } from "~/lib/y-markdown";
import { formatAnchor, blockHash } from "~/shared/agent-protocol";

function docFrom(lines: string[]): Y.Doc {
  const doc = new Y.Doc();
  insertMarkdownBlocks(doc, 0, lines.join("\n"));
  return doc;
}

describe("y-markdown", () => {
  it("round-trips plain markdown", () => {
    const doc = docFrom(["# Title", "", "Body text."]);
    expect(yDocToMarkdown(doc)).toBe("# Title\n\nBody text.");
    expect(getBlocks(doc)).toHaveLength(3);
    expect(getBlocks(doc)[0].hash).toBe(blockHash("# Title"));
  });

  it("round-trips CriticMarkup marks as delimiters", () => {
    const doc = docFrom(["keep {--cut this--} and {++add this++} end"]);
    expect(yDocToMarkdown(doc)).toBe("keep {--cut this--} and {++add this++} end");
  });

  it("resolveAnchor finds by hash after blocks shift", () => {
    const doc = docFrom(["alpha", "beta", "gamma"]);
    const anchor = formatAnchor(getBlocks(doc)[2]);       // gamma at index 2
    insertMarkdownBlocks(doc, 0, "zero");                 // shifts everything down
    const r = resolveAnchor(doc, anchor);
    expect(r).toEqual({ index: 3 });
  });

  it("resolveAnchor reports stale_anchor with a snippet", () => {
    const doc = docFrom(["alpha", "beta"]);
    const anchor = formatAnchor(getBlocks(doc)[1]);
    deleteBlocks(doc, 1, 1);
    const r = resolveAnchor(doc, anchor);
    expect(r).toMatchObject({ error: "stale_anchor" });
    expect((r as { snippet: string }).snippet).toContain("alpha");
  });
});
