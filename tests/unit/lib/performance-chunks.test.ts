import { describe, it, expect } from "vitest";
import { chunkTyping } from "~/lib/performance-chunks";

describe("chunkTyping", () => {
  it("covers the whole text in order", () => {
    const ticks = chunkTyping("Hello world. Bye.", "natural", () => 0.5);
    expect(ticks.map((t) => t.chunk).join("")).toBe("Hello world. Bye.");
  });

  it("pauses after sentence ends, by more than a whole tick", () => {
    const ticks = chunkTyping("Hi. Yo", "natural", () => 0.5);
    const afterDot = ticks.find((t) => t.chunk.startsWith(" Yo") || t.chunk.startsWith("Yo"));
    // The base delay at rng 0.5 is 84ms; the pause adds 100-300 on top.
    expect(afterDot!.delayMs).toBeGreaterThanOrEqual(184);
    expect(afterDot!.delayMs).toBeLessThanOrEqual(407);
  });

  it("fast pace uses bigger chunks", () => {
    expect(chunkTyping("x".repeat(100), "fast", () => 0.5).length)
      .toBeLessThan(chunkTyping("x".repeat(100), "natural", () => 0.5).length);
  });

  it("returns an empty array for empty text", () => {
    expect(chunkTyping("", "natural", () => 0.5)).toEqual([]);
  });

  it("natural pace ticks fall within the 2-4 char, 60-107ms base range", () => {
    for (const [rng, chars, delay] of [[0, 2, 60], [0.999, 4, 107]] as const) {
      for (const tick of chunkTyping("abcdefghij", "natural", () => rng)) {
        expect(tick.chunk.length).toBeLessThanOrEqual(chars);
        expect(tick.delayMs).toBe(delay);
      }
    }
  });

  it("fast pace ticks fall within the 6-12 char, 7-13ms base range", () => {
    for (const [rng, chars, delay] of [[0, 6, 7], [0.999, 12, 13]] as const) {
      for (const tick of chunkTyping("abcdefghijklmnopqrstuvwxyz", "fast", () => rng)) {
        expect(tick.chunk.length).toBeLessThanOrEqual(chars);
        expect(tick.delayMs).toBe(delay);
      }
    }
  });

  it("types about three characters per 100ms at natural pace", () => {
    const text = "abcdefghij".repeat(30);
    const ticks = chunkTyping(text, "natural", () => 0.5);
    const totalMs = ticks.reduce((sum, t) => sum + t.delayMs, 0);
    // 300 characters at 3 per 84ms is 8.4 seconds; there are no sentence
    // endings in the text, so nothing is added on top.
    expect(Math.round((text.length / totalMs) * 1000)).toBeGreaterThanOrEqual(30);
  });

  it("is deterministic for a fixed rng", () => {
    const a = chunkTyping("Hello world. Bye.", "natural", () => 0.5);
    const b = chunkTyping("Hello world. Bye.", "natural", () => 0.5);
    expect(a).toEqual(b);
  });
});
