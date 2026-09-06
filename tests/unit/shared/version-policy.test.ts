import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  MAX_VERSIONS,
  MAX_VERSION_BYTES,
  shouldSnapshotOnDelta,
  pruneOrder,
  primaryAuthor,
  reasonLabel,
  clientIdsInUpdate,
  type VersionAuthor,
} from "~/shared/version-policy";

const author = (id: string, kind: VersionAuthor["kind"] = "human"): VersionAuthor => ({
  kind,
  id,
  name: id,
  color: "#000",
});

describe("shouldSnapshotOnDelta", () => {
  it("fires when the size moves by more than a fifth either way", () => {
    expect(shouldSnapshotOnDelta(1000, 1250, 0, 1000)).toBe(true);
    expect(shouldSnapshotOnDelta(1000, 780, 0, 1000)).toBe(true);
    expect(shouldSnapshotOnDelta(1000, 1100, 0, 1000)).toBe(false);
  });
  it("fires after ten minutes of continuous editing regardless of size", () => {
    expect(shouldSnapshotOnDelta(1000, 1001, 0, 10 * 60_000 + 1)).toBe(true);
    expect(shouldSnapshotOnDelta(1000, 1001, 0, 9 * 60_000)).toBe(false);
  });
  it("treats the first snapshot of a non-empty document as due", () => {
    expect(shouldSnapshotOnDelta(null, 10, null, 5)).toBe(true);
    expect(shouldSnapshotOnDelta(null, 0, null, 5)).toBe(false);
  });
});

describe("pruneOrder", () => {
  it("keeps deliberate checkpoints and drops the oldest automatic rows first", () => {
    const rows = Array.from({ length: MAX_VERSIONS + 3 }, (_, i) => ({
      id: i + 1,
      reason: i % 50 === 0 ? ("pre_replace" as const) : ("idle" as const),
      created_at: i,
    }));
    const drop = pruneOrder(rows);
    expect(drop).toHaveLength(3);
    expect(drop).toEqual([2, 3, 4]);
  });
  it("drops nothing under the cap", () => {
    expect(pruneOrder([{ id: 1, reason: "idle", created_at: 0 }])).toEqual([]);
  });
  it("falls back to the oldest checkpoints when only checkpoints remain", () => {
    const rows = Array.from({ length: MAX_VERSIONS + 1 }, (_, i) => ({
      id: i + 1,
      reason: "pre_replace" as const,
      created_at: i,
    }));
    expect(pruneOrder(rows)).toEqual([1]);
  });
});

describe("primaryAuthor", () => {
  it("is the most recent contributor, or unknown when nobody is known", () => {
    expect(primaryAuthor([author("a"), author("b")])!.id).toBe("b");
    expect(primaryAuthor([]).kind).toBe("unknown");
    expect(primaryAuthor([]).name).toBe("Someone");
  });
});

describe("reasonLabel", () => {
  it("names the checkpoint in plain words", () => {
    expect(reasonLabel("pre_replace", "Ada's Agent")).toBe("Before Ada's Agent replaced blocks");
    expect(reasonLabel("pre_accept_all")).toBe("Before Accept all");
    expect(reasonLabel("restore")).toBe("Restored");
    expect(reasonLabel("idle")).toBe("Edited");
    expect(reasonLabel("manual")).toBe("Saved");
  });
});

describe("clientIdsInUpdate", () => {
  it("lists the distinct clients whose structs an update carries", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("t").insert(0, "hello");
    const fromA = Y.encodeStateAsUpdate(a);
    Y.applyUpdate(b, fromA);
    b.getText("t").insert(5, " world");
    const merged = Y.encodeStateAsUpdate(b);
    const ids = clientIdsInUpdate(merged);
    expect(ids).toContain(a.clientID);
    expect(ids).toContain(b.clientID);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("limits", () => {
  it("keeps snapshots under SQLite's value cap", () => {
    expect(MAX_VERSION_BYTES).toBeLessThan(2 * 1024 * 1024);
  });
});
