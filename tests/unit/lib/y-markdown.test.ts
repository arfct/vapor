import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { getBlocks, yDocToMarkdown, resolveAnchor, buildMarkdownBlocks, insertBlockNodes, deleteBlocks } from "~/lib/y-markdown";
import { formatAnchor, blockHash } from "~/shared/agent-protocol";

/** buildMarkdownBlocks + insertBlockNodes, for markdown known to be valid. */
function insertMarkdown(doc: Y.Doc, index: number, markdown: string): void {
  const built = buildMarkdownBlocks(markdown);
  if (!built.ok) throw new Error(built.message);
  insertBlockNodes(doc, index, built.nodes);
}

function docFrom(lines: string[]): Y.Doc {
  const doc = new Y.Doc();
  insertMarkdown(doc, 0, lines.join("\n"));
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
    insertMarkdown(doc, 0, "zero");                       // shifts everything down
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

  it("buildMarkdownBlocks reports unsupported markup instead of throwing, and touches no document", () => {
    const doc = docFrom(["alpha"]);
    const built = buildMarkdownBlocks("fine\n{~~old~>new~~}");
    expect(built.ok).toBe(false);
    expect(!built.ok && built.message).toContain("Unsupported CriticMarkup");
    expect(yDocToMarkdown(doc)).toBe("alpha");
  });

  it("round-trips overlapping highlight+addition marks on the same run without dropping either delimiter", () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("default");
    const para = new Y.XmlElement("paragraph");
    const ytext = new Y.XmlText("keep highlighted addition end");
    para.insert(0, [ytext]);
    frag.insert(0, [para]);

    const start = "keep ".length;
    const length = "highlighted addition".length;
    // Apply both mark types to the same run in one format call, the way
    // overlapping criticHighlight + criticAddition marks would land on the
    // Yjs delta (criticHighlight declares no `excludes` in critic-marks.ts).
    ytext.format(start, length, { criticHighlight: {}, criticAddition: {} });

    expect(yDocToMarkdown(doc)).toBe("keep {=={++highlighted addition++}==} end");
  });
});
