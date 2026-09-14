import { describe, it, expect } from "vitest";
import { diffBlocks, patchCharge } from "~/shared/block-patch";

const texts = (...t: string[]) => t;

describe("diffBlocks (#59)", () => {
  it("keeps every block when nothing changed", () => {
    const ops = diffBlocks(texts("# A", "One.", "Two."), texts("# A", "One.", "Two."));
    expect(ops).toEqual([]);
  });

  it("replaces only the block that differs, so the others keep their ids", () => {
    const ops = diffBlocks(texts("# A", "One.", "Two."), texts("# A", "One, revised.", "Two."));
    expect(ops).toEqual([{ kind: "replace", index: 1, markdown: "One, revised." }]);
  });

  it("inserts a new block without touching its neighbours", () => {
    const ops = diffBlocks(texts("# A", "One."), texts("# A", "Nought.", "One."));
    expect(ops).toEqual([{ kind: "insert", index: 1, markdown: "Nought." }]);
  });

  it("appends at the end", () => {
    const ops = diffBlocks(texts("# A"), texts("# A", "One."));
    expect(ops).toEqual([{ kind: "insert", index: 1, markdown: "One." }]);
  });

  it("deletes a block that is gone", () => {
    const ops = diffBlocks(texts("# A", "One.", "Two."), texts("# A", "Two."));
    expect(ops).toEqual([{ kind: "delete", index: 1 }]);
  });

  it("pairs a run of changes one to one, so ids survive across the whole run", () => {
    const ops = diffBlocks(texts("# A", "One.", "Two.", "End."), texts("# A", "Uno.", "Dos.", "End."));
    expect(ops).toEqual([
      { kind: "replace", index: 1, markdown: "Uno." },
      { kind: "replace", index: 2, markdown: "Dos." },
    ]);
  });

  it("pairs what it can and inserts the rest when the run grew", () => {
    const ops = diffBlocks(texts("# A", "One.", "End."), texts("# A", "Uno.", "Dos.", "End."));
    expect(ops).toEqual([
      { kind: "replace", index: 1, markdown: "Uno." },
      { kind: "insert", index: 2, markdown: "Dos." },
    ]);
  });

  it("pairs what it can and deletes the rest when the run shrank", () => {
    const ops = diffBlocks(texts("# A", "One.", "Two.", "End."), texts("# A", "Uno.", "End."));
    expect(ops).toEqual([
      { kind: "replace", index: 1, markdown: "Uno." },
      { kind: "delete", index: 2 },
    ]);
  });

  it("empties a document", () => {
    expect(diffBlocks(texts("# A", "One."), texts())).toEqual([
      { kind: "delete", index: 0 },
      { kind: "delete", index: 1 },
    ]);
  });

  it("fills an empty document", () => {
    expect(diffBlocks(texts(), texts("# A"))).toEqual([{ kind: "insert", index: 0, markdown: "# A" }]);
  });

  it("indexes every op against the document as it was read, not as it is being built", () => {
    // A delete early on does not shift the index of a later replace: the
    // caller applies from the end, and the test fixes that contract.
    const ops = diffBlocks(texts("A", "B", "C", "D"), texts("A", "C", "D2"));
    expect(ops).toEqual([
      { kind: "delete", index: 1 },
      { kind: "replace", index: 3, markdown: "D2" },
    ]);
  });

  it("moves a block by deleting it and inserting it, rather than rewriting everything between", () => {
    const ops = diffBlocks(texts("A", "B", "C"), texts("C", "A", "B"));
    expect(ops.filter((o) => o.kind === "replace")).toHaveLength(0);
  });
});

describe("patchCharge (#59)", () => {
  it("charges for the text a patch adds, not for the document it restates", () => {
    const ops = diffBlocks(texts("# A", "a".repeat(2000), "End."), texts("# A", "b".repeat(10), "End."));
    expect(patchCharge(ops)).toBe(10);
  });

  it("charges nothing for a patch that only deletes", () => {
    expect(patchCharge(diffBlocks(texts("A", "B"), texts("A")))).toBe(0);
  });

  it("charges nothing at all when nothing changed", () => {
    expect(patchCharge(diffBlocks(texts("A"), texts("A")))).toBe(0);
  });
});
