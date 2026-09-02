import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  parseMarkdown,
  serializePmDoc,
  yDocToMarkdown,
  getBlocks,
  buildMarkdownBlocks,
  insertBlockNodes,
  resolveAnchor,
  formatAnchor,
  buildTypedBlock,
  mintBlockId,
  BLOCK_ID_RE,
  getAgentInstructions,
} from "~/shared/rich-markdown";
import { blockHash } from "~/shared/agent-protocol";

function roundTrip(md: string): string {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error(parsed.message);
  return serializePmDoc(parsed.doc);
}

function docFromMarkdown(md: string): Y.Doc {
  const doc = new Y.Doc();
  const built = buildMarkdownBlocks(md);
  if (!built.ok) throw new Error(built.message);
  insertBlockNodes(doc, 0, built.nodes);
  return doc;
}

describe("markdown round-trips", () => {
  const stable = [
    "Plain paragraph text.",
    "# Heading one",
    "## Heading two",
    "### Heading three",
    "Some **bold** and *italic* and ~~struck~~ and `coded` text.",
    "A [link](https://vapor.fyi) inline.",
    "> A quote",
    "- one\n- two\n- three",
    "1. first\n2. second",
    "```js\nconst x = 1;\n```",
    "---",
    "Nested *italic with **bold** inside* run.",
    "- item with **bold**\n- item with `code`",
  ];

  for (const md of stable) {
    it(`stable: ${JSON.stringify(md.slice(0, 40))}`, () => {
      expect(roundTrip(md)).toBe(md);
    });
  }

  it("round-trip is idempotent after one normalization pass", () => {
    const messy = "Heading\n=======\n\n1) item one\n2) item two\n\n_alt italic_ and __alt bold__";
    const once = roundTrip(messy);
    expect(roundTrip(once)).toBe(once);
  });

  it("critic marks survive", () => {
    const md = "This {++was added++} and {--was removed--} here.";
    expect(roundTrip(md)).toBe(md);
  });

  it("highlight + comment pair survives", () => {
    const md = "The {==stocky==}{>>rude<<} bulldog.";
    expect(roundTrip(md)).toBe(md);
  });

  it("images and tables degrade to literal text without throwing", () => {
    const parsed = parseMarkdown("![alt](x.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(parsed.ok).toBe(true);
  });
});

describe("Y.Doc conversions", () => {
  it("yDocToMarkdown matches the source markdown", () => {
    const md = "# Title\n\nBody with **bold**.\n\n- a\n- b";
    expect(yDocToMarkdown(docFromMarkdown(md))).toBe(md);
  });

  it("getBlocks returns one block per top-level node with ids", () => {
    const blocks = getBlocks(docFromMarkdown("# Title\n\nPara.\n\n- a\n- b"));
    expect(blocks.map((b) => b.text)).toEqual(["# Title", "Para.", "- a\n- b"]);
    for (const b of blocks) {
      expect(b.id).toMatch(BLOCK_ID_RE);
      expect(b.hash).toBe(blockHash(b.text));
    }
  });

  it("critic marks survive the Y round trip", () => {
    const md = "Keep {++this++} and {==that==}{>>why?<<} intact.";
    expect(yDocToMarkdown(docFromMarkdown(md))).toBe(md);
  });

  it("legacy flat paragraphs (pre-rich docs) still read", () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("default");
    const para = new Y.XmlElement("paragraph");
    para.insert(0, [new Y.XmlText("plain old line")]);
    frag.insert(0, [para]);
    const blocks = getBlocks(doc);
    expect(blocks[0].text).toBe("plain old line");
    expect(blocks[0].id).toBeNull();
  });
});

describe("resolveAnchor", () => {
  it("resolves by block id and checks the hash", () => {
    const doc = docFromMarkdown("First.\n\nSecond.");
    const blocks = getBlocks(doc);
    const anchor = formatAnchor(blocks[1]);
    expect(resolveAnchor(doc, anchor)).toEqual({ index: 1 });
  });

  it("returns stale_block with the current block when the hash mismatches", () => {
    const doc = docFromMarkdown("First.\n\nSecond.");
    const blocks = getBlocks(doc);
    const stale = `${blocks[1].id}-${"0".repeat(8)}`;
    const result = resolveAnchor(doc, stale);
    expect(result).toMatchObject({ error: "stale_block" });
    if ("error" in result) expect(result.snippet).toContain("Second.");
  });

  it("falls back to legacy hash anchors", () => {
    const doc = docFromMarkdown("First.\n\nSecond.");
    const blocks = getBlocks(doc);
    expect(resolveAnchor(doc, `b1-${blocks[1].hash}`)).toEqual({ index: 1 });
  });

  it("unknown anchors are stale_anchor with an overview snippet", () => {
    const doc = docFromMarkdown("First.");
    const result = resolveAnchor(doc, "zzzzzzzz-00000000");
    expect(result).toMatchObject({ error: "stale_anchor" });
  });
});

describe("buildTypedBlock", () => {
  it("returns an empty-text skeleton plus fills that reproduce the block", () => {
    const parsed = parseMarkdown("Some **bold** and plain text.");
    if (!parsed.ok) throw new Error(parsed.message);
    const block = parsed.doc.child(0);
    const { element, fills } = buildTypedBlock(block);

    const doc = new Y.Doc();
    doc.getXmlFragment("default").insert(0, [element]);

    // Skeleton is empty
    expect(yDocToMarkdown(doc)).toBe("");

    // Typing every run reproduces the original text with formatting
    for (const fill of fills) {
      let offset = fill.ytext.length;
      for (const run of fill.runs) {
        fill.ytext.insert(offset, run.text, run.attrs as Record<string, unknown>);
        offset += run.text.length;
      }
    }
    expect(yDocToMarkdown(doc)).toBe("Some **bold** and plain text.");
  });

  it("multi-node blocks (lists) fill item by item", () => {
    const parsed = parseMarkdown("- alpha\n- beta");
    if (!parsed.ok) throw new Error(parsed.message);
    const { element, fills } = buildTypedBlock(parsed.doc.child(0));
    const doc = new Y.Doc();
    doc.getXmlFragment("default").insert(0, [element]);
    expect(fills).toHaveLength(2);
    for (const fill of fills) {
      for (const run of fill.runs) fill.ytext.insert(fill.ytext.length, run.text, run.attrs as never);
    }
    expect(yDocToMarkdown(doc)).toBe("- alpha\n- beta");
  });
});

describe("mintBlockId", () => {
  it("mints 8-char ids", () => {
    for (let i = 0; i < 50; i++) expect(mintBlockId()).toMatch(BLOCK_ID_RE);
  });
});

describe("agent instructions block", () => {
  const md = "# Title\n\n```agent\nKeep suggestions short.\nAsk before rewriting.\n```\n\n```js\nconsole.log(1);\n```";

  it("parses an `agent` fence to agentInstructions and leaves other fences as code", () => {
    const parsed = parseMarkdown(md);
    if (!parsed.ok) throw new Error(parsed.message);
    const types = parsed.doc.content.content.map((n) => n.type.name);
    expect(types).toEqual(["heading", "agentInstructions", "codeBlock"]);
    expect(parsed.doc.child(1).textContent).toBe("Keep suggestions short.\nAsk before rewriting.");
  });

  it("round-trips through markdown unchanged", () => {
    expect(roundTrip(md)).toBe(md);
  });

  it("getAgentInstructions collects block text in order, ignoring code", () => {
    const doc = docFromMarkdown(md + "\n\n```agent\nSecond note.\n```");
    expect(getAgentInstructions(doc)).toEqual([
      "Keep suggestions short.\nAsk before rewriting.",
      "Second note.",
    ]);
    expect(getAgentInstructions(docFromMarkdown("Just prose."))).toEqual([]);
  });
});

describe("task lists", () => {
  const md = "- [ ] Write the plan\n- [x] Ship it";

  it("parses GFM task items into taskList/taskItem with checked state", () => {
    const parsed = parseMarkdown(md);
    if (!parsed.ok) throw new Error(parsed.message);
    const list = parsed.doc.child(0);
    expect(list.type.name).toBe("taskList");
    expect(list.childCount).toBe(2);
    expect(list.child(0).attrs.checked).toBe(false);
    expect(list.child(1).attrs.checked).toBe(true);
    expect(list.child(0).textContent).toBe("Write the plan");
  });

  it("round-trips unchanged", () => {
    expect(roundTrip(md)).toBe(md);
  });

  it("leaves a list with any plain item as a bullet list", () => {
    const parsed = parseMarkdown("- [ ] task\n- plain");
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.doc.child(0).type.name).toBe("bulletList");
    expect(parsed.doc.child(0).child(0).textContent).toBe("[ ] task");
  });

  it("survives the Y.Doc round trip with checked state intact", () => {
    expect(yDocToMarkdown(docFromMarkdown(md))).toBe(md);
  });
});
