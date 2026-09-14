import { describe, it, expect } from "vitest";
import { shouldInvite, stripCommentRuns } from "~/shared/mention-policy";

describe("shouldInvite", () => {
  it("invites an absent agent that has never been invited", () => {
    expect(shouldInvite({ present: false, invitedAt: null })).toBe(true);
  });

  it("does not invite an agent that is present: it sees the mention on its next read", () => {
    expect(shouldInvite({ present: true, invitedAt: null })).toBe(false);
  });

  it("invites once per document, however long ago", () => {
    expect(shouldInvite({ present: false, invitedAt: 1 })).toBe(false);
    expect(shouldInvite({ present: false, invitedAt: Date.now() })).toBe(false);
  });
});

describe("stripCommentRuns", () => {
  it("removes inline comment runs and keeps the prose around them", () => {
    expect(stripCommentRuns("Intro{>>@scribe tighten this<<} and outro.")).toBe("Intro and outro.");
  });

  it("removes every run, including multi-line ones", () => {
    expect(stripCommentRuns("a{>>one<<}b{>>two\nlines<<}c")).toBe("abc");
  });

  it("leaves text without comments alone", () => {
    expect(stripCommentRuns("ping @scribe please")).toBe("ping @scribe please");
  });
});
