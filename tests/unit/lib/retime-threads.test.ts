import { describe, it, expect } from "vitest";
import { retimeThreads, DEMO_AGES } from "~/lib/retime-threads";
import type { ThreadData } from "~/shared/types";

const author = { name: "Alice", color: "#BA68C8", colorLight: "#E1BEE7" };

const thread = (createdAt: number, replies: ThreadData["replies"] = []): ThreadData => ({
  id: `t${createdAt}`,
  commentText: "note",
  author,
  createdAt,
  resolved: false,
  replies,
});

describe("retimeThreads", () => {
  const now = 1_700_000_000_000;

  it("dates threads a fixed mix of ages before now, in order", () => {
    const out = retimeThreads([thread(1), thread(2), thread(3), thread(4)], now);
    expect(out.map((t) => now - t.createdAt)).toEqual([...DEMO_AGES, DEMO_AGES[0]]);
  });

  it("keeps replies the same distance after their thread, never in the future", () => {
    const base = 1_000_000;
    const out = retimeThreads(
      [thread(base, [{ id: "r", author, text: "hi", createdAt: base + 5 * 60_000 }])],
      now,
    );
    expect(out[0].replies[0].createdAt - out[0].createdAt).toBe(5 * 60_000);

    const late = retimeThreads(
      [thread(base), thread(base), thread(base, [{ id: "r", author, text: "hi", createdAt: base + 60 * 60_000 }])],
      now,
    );
    expect(late[2].replies[0].createdAt).toBe(now);
  });

  it("leaves everything else untouched", () => {
    const [out] = retimeThreads([thread(5)], now);
    expect(out).toMatchObject({ id: "t5", commentText: "note", author, resolved: false });
  });
});
