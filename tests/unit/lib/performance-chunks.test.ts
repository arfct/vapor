import { describe, it, expect } from "vitest";
import { chunkTyping } from "~/lib/performance-chunks";

describe("chunkTyping", () => {
  it("covers the whole text in order", () => {
    const ticks = chunkTyping("Hello world. Bye.", "natural", () => 0.5);
    expect(ticks.map((t) => t.chunk).join("")).toBe("Hello world. Bye.");
  });

  it("pauses after sentence ends", () => {
    const ticks = chunkTyping("Hi. Yo", "natural", () => 0.5);
    const afterDot = ticks.find((t) => t.chunk.startsWith(" Yo") || t.chunk.startsWith("Yo"));
    expect(afterDot!.delayMs).toBeGreaterThanOrEqual(300);
  });

  it("fast pace uses bigger chunks", () => {
    expect(chunkTyping("x".repeat(100), "fast", () => 0.5).length)
      .toBeLessThan(chunkTyping("x".repeat(100), "natural", () => 0.5).length);
  });

  it("returns an empty array for empty text", () => {
    expect(chunkTyping("", "natural", () => 0.5)).toEqual([]);
  });

  it("natural pace ticks fall within the 2-6 char, 30-80ms base range", () => {
    const ticks = chunkTyping("abcdefghij", "natural", () => 0);
    for (const tick of ticks) {
      expect(tick.chunk.length).toBeGreaterThanOrEqual(1);
      expect(tick.chunk.length).toBeLessThanOrEqual(6);
      expect(tick.delayMs).toBeGreaterThanOrEqual(30);
    }
  });

  it("fast pace ticks fall within the 8-16 char, 10-20ms base range", () => {
    const ticks = chunkTyping("abcdefghijklmnopqrstuvwxyz", "fast", () => 0);
    for (const tick of ticks) {
      expect(tick.chunk.length).toBeGreaterThanOrEqual(1);
      expect(tick.chunk.length).toBeLessThanOrEqual(16);
      expect(tick.delayMs).toBeGreaterThanOrEqual(10);
      expect(tick.delayMs).toBeLessThanOrEqual(20);
    }
  });

  it("is deterministic for a fixed rng", () => {
    const a = chunkTyping("Hello world. Bye.", "natural", () => 0.5);
    const b = chunkTyping("Hello world. Bye.", "natural", () => 0.5);
    expect(a).toEqual(b);
  });
});
