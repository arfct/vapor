import { describe, it, expect } from "vitest";
import {
  matchThreadsToComments,
  findOrphanedThreads,
  type DocumentComment,
} from "~/lib/comment-threads";
import type { ThreadData } from "~/shared/types";

function makeThread(overrides: Partial<ThreadData> = {}): ThreadData {
  return {
    id: "t1",
    commentText: "A comment",
    author: { name: "Jane", color: "#E57373", colorLight: "#FFCDD2" },
    createdAt: Date.now(),
    resolved: false,
    replies: [],
    ...overrides,
  };
}

function makeComment(overrides: Partial<DocumentComment> = {}): DocumentComment {
  return {
    commentText: "A comment",
    position: 0,
    endPosition: 10,
    ...overrides,
  };
}

describe("matchThreadsToComments", () => {
  it("matches thread to comment by commentText", () => {
    const threads = [makeThread({ id: "t1", commentText: "A comment" })];
    const comments = [makeComment({ commentText: "A comment", position: 5, endPosition: 15 })];
    const matched = matchThreadsToComments(threads, comments);
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe("t1");
    expect(matched[0].position).toBe(5);
    expect(matched[0].endPosition).toBe(15);
  });

  it("unmatched thread has no position or endPosition", () => {
    const threads = [makeThread({ id: "t1", commentText: "Missing" })];
    const comments = [makeComment({ commentText: "Other" })];
    const matched = matchThreadsToComments(threads, comments);
    expect(matched).toHaveLength(1);
    expect(matched[0].position).toBeUndefined();
    expect(matched[0].endPosition).toBeUndefined();
  });

  it("duplicate comment texts matched by order", () => {
    const threads = [
      makeThread({ id: "t1", commentText: "Same", createdAt: 1000 }),
      makeThread({ id: "t2", commentText: "Same", createdAt: 2000 }),
    ];
    const comments = [
      makeComment({ commentText: "Same", position: 0, endPosition: 10 }),
      makeComment({ commentText: "Same", position: 20, endPosition: 30 }),
    ];
    const matched = matchThreadsToComments(threads, comments);
    expect(matched).toHaveLength(2);
    // t1 (earlier) matches first occurrence, t2 matches second
    expect(matched[0].position).toBeLessThan(matched[1].position!);
  });

  it("empty threads returns empty result", () => {
    const comments = [makeComment()];
    expect(matchThreadsToComments([], comments)).toEqual([]);
  });

  it("empty comments means threads all unmatched", () => {
    const threads = [makeThread()];
    const matched = matchThreadsToComments(threads, []);
    expect(matched).toHaveLength(1);
    expect(matched[0].position).toBeUndefined();
  });
});

describe("findOrphanedThreads", () => {
  it("returns threads with no matching comment", () => {
    const threads = [
      makeThread({ id: "t1", commentText: "Exists" }),
      makeThread({ id: "t2", commentText: "Missing" }),
    ];
    const comments = [makeComment({ commentText: "Exists" })];
    const orphans = findOrphanedThreads(threads, comments);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].id).toBe("t2");
  });

  it("no orphans when all threads match", () => {
    const threads = [makeThread({ commentText: "Here" })];
    const comments = [makeComment({ commentText: "Here" })];
    expect(findOrphanedThreads(threads, comments)).toEqual([]);
  });

  it("all orphans when no comments in document", () => {
    const threads = [makeThread({ id: "t1" }), makeThread({ id: "t2" })];
    const orphans = findOrphanedThreads(threads, []);
    expect(orphans).toHaveLength(2);
  });
});

describe("threadIdForComment (duplicate-thread regression)", () => {
  it("is deterministic across clients for the same comment mark", async () => {
    const { threadIdForComment } = await import("~/lib/useThreads");
    const a = threadIdForComment({ commentText: "hi!", highlightText: "visiting" });
    const b = threadIdForComment({ commentText: "hi!", highlightText: "visiting" });
    expect(a).toBe(b);
    expect(a).toMatch(/^t-[0-9a-f]{8}$/);
    // Different comments get different keys.
    expect(threadIdForComment({ commentText: "nice", highlightText: "fled" })).not.toBe(a);
  });
});
