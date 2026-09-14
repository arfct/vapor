import { describe, it, expect } from "vitest";
import { changesSince, type BlockChangeRow } from "~/shared/block-changes";
import type { DocBlock } from "~/shared/rich-markdown";

const block = (index: number, id: string, text: string): DocBlock => ({
  index,
  id,
  hash: "a1b2c3d4",
  text,
});

const row = (seq: number, blockId: string, kind: BlockChangeRow["kind"]): BlockChangeRow => ({ seq, blockId, kind });

const doc = [block(0, "aaaaaaaa", "First."), block(1, "bbbbbbbb", "Second.")];

describe("changesSince (#87)", () => {
  it("returns one entry per changed block, with the anchor and the current text", () => {
    const out = changesSince(doc, [row(7, "bbbbbbbb", "changed")], { cursor: 5, oldestRetainedSeq: 1, latestSeq: 7 });
    expect(out.blocks).toEqual([{ anchor: "bbbbbbbb-a1b2c3d4", text: "Second.", change: "changed" }]);
    expect(out.removed).toEqual([]);
    expect(out.cursor).toBe(7);
    expect(out.truncated).toBe(false);
  });

  it("collapses repeated changes to one entry at the block's current state", () => {
    const rows = [row(6, "aaaaaaaa", "changed"), row(7, "aaaaaaaa", "changed"), row(8, "aaaaaaaa", "changed")];
    const out = changesSince(doc, rows, { cursor: 5, oldestRetainedSeq: 1, latestSeq: 8 });
    expect(out.blocks).toHaveLength(1);
    expect(out.cursor).toBe(8);
  });

  it("reports a block that is no longer in the document as removed, by its id", () => {
    const out = changesSince(doc, [row(9, "cccccccc", "removed")], { cursor: 5, oldestRetainedSeq: 1, latestSeq: 9 });
    expect(out.blocks).toEqual([]);
    expect(out.removed).toEqual(["cccccccc"]);
  });

  it("reports a block added and then deleted inside the window as removed only", () => {
    const rows = [row(6, "cccccccc", "added"), row(7, "cccccccc", "removed")];
    const out = changesSince(doc, rows, { cursor: 5, oldestRetainedSeq: 1, latestSeq: 7 });
    expect(out.blocks).toEqual([]);
    expect(out.removed).toEqual(["cccccccc"]);
  });

  it("keeps added distinct from changed, so a caller can tell a new block from an edited one", () => {
    const out = changesSince(doc, [row(6, "aaaaaaaa", "added")], { cursor: 5, oldestRetainedSeq: 1, latestSeq: 6 });
    expect(out.blocks[0].change).toBe("added");
  });

  it("reports a block deleted and re-added inside the window as added, not removed", () => {
    const rows = [row(6, "aaaaaaaa", "removed"), row(7, "aaaaaaaa", "added")];
    const out = changesSince(doc, rows, { cursor: 5, oldestRetainedSeq: 1, latestSeq: 7 });
    expect(out.removed).toEqual([]);
    expect(out.blocks[0]).toMatchObject({ anchor: "aaaaaaaa-a1b2c3d4", change: "added" });
  });

  it("returns blocks in document order, not in the order they were touched", () => {
    const rows = [row(6, "bbbbbbbb", "changed"), row(7, "aaaaaaaa", "changed")];
    const out = changesSince(doc, rows, { cursor: 5, oldestRetainedSeq: 1, latestSeq: 7 });
    expect(out.blocks.map((b) => b.anchor)).toEqual(["aaaaaaaa-a1b2c3d4", "bbbbbbbb-a1b2c3d4"]);
  });

  it("truncates when the cursor is older than the oldest row still kept", () => {
    const out = changesSince(doc, [row(40, "aaaaaaaa", "changed")], { cursor: 5, oldestRetainedSeq: 30, latestSeq: 40 });
    expect(out.truncated).toBe(true);
    expect(out.blocks).toEqual([]);
    expect(out.removed).toEqual([]);
    expect(out.cursor).toBe(40);
  });

  it("truncates when there is no cursor at all: there is no baseline to diff against", () => {
    const out = changesSince(doc, [], { cursor: null, oldestRetainedSeq: 0, latestSeq: 12 });
    expect(out.truncated).toBe(true);
    expect(out.cursor).toBe(12);
  });

  it("returns nothing, and holds the cursor, when nothing has changed", () => {
    const out = changesSince(doc, [], { cursor: 12, oldestRetainedSeq: 1, latestSeq: 12 });
    expect(out).toEqual({ blocks: [], removed: [], cursor: 12, truncated: false });
  });

  it("does not truncate a cursor at or past the latest seq on an empty table", () => {
    const out = changesSince(doc, [], { cursor: 0, oldestRetainedSeq: 0, latestSeq: 0 });
    expect(out.truncated).toBe(false);
    expect(out.cursor).toBe(0);
  });
});
