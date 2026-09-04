import { describe, it, expect } from "vitest";
import { layoutComments } from "~/lib/comment-layout";

const item = (id: string, anchor: number, height = 100) => ({ id, anchor, height });

describe("layoutComments", () => {
  it("puts well-separated cards at their anchors", () => {
    const tops = layoutComments([item("a", 100), item("b", 400)], null);
    expect(tops.get("a")).toBe(100);
    expect(tops.get("b")).toBe(400);
  });

  it("stacks overlapping cards downward with a gap", () => {
    const tops = layoutComments([item("a", 100), item("b", 120), item("c", 130)], null, 8);
    expect(tops.get("a")).toBe(100);
    expect(tops.get("b")).toBe(208);
    expect(tops.get("c")).toBe(316);
  });

  it("pins the active card to its anchor and moves the ones above out of the way", () => {
    const tops = layoutComments([item("a", 100), item("b", 120), item("c", 130)], "c", 8);
    expect(tops.get("c")).toBe(130);
    expect(tops.get("b")).toBe(130 - 8 - 100);
    // "a" would need to sit above the top of the rail; it stops at 0.
    expect(tops.get("a")).toBe(0);
  });

  it("stacks the cards below the active one from its position", () => {
    const tops = layoutComments([item("a", 100), item("b", 110), item("c", 500)], "a", 8);
    expect(tops.get("a")).toBe(100);
    expect(tops.get("b")).toBe(208);
    expect(tops.get("c")).toBe(500);
  });

  it("orders by anchor regardless of input order", () => {
    const tops = layoutComments([item("late", 900), item("early", 100)], null);
    expect(tops.get("early")).toBe(100);
    expect(tops.get("late")).toBe(900);
  });

  it("places cards without an anchor after the last anchored card", () => {
    const tops = layoutComments([item("orphan", Number.NaN), item("a", 300)], null, 8);
    expect(tops.get("a")).toBe(300);
    expect(tops.get("orphan")).toBe(408);
  });
});
