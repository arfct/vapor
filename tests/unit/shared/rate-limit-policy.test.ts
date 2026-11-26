import { describe, it, expect } from "vitest";
import { checkMutation, RATE_LIMITS, type MutationLogEntry } from "~/shared/rate-limit-policy";

const NOW = 10 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const limits = { mutationsPerMinute: 3, charsPerHour: 1000 };

describe("RATE_LIMITS", () => {
  it("gives signed-in agents more room than anonymous ones on both windows", () => {
    expect(RATE_LIMITS.principal.mutationsPerMinute).toBeGreaterThan(RATE_LIMITS.anonymous.mutationsPerMinute);
    expect(RATE_LIMITS.principal.charsPerHour).toBeGreaterThan(RATE_LIMITS.anonymous.charsPerHour);
  });
});

describe("checkMutation", () => {
  it("allows a mutation under both limits and records it", () => {
    const verdict = checkMutation([], 100, limits, NOW);
    expect(verdict).toEqual({ allowed: true, log: [{ at: NOW, chars: 100 }] });
  });

  it("prunes entries older than an hour, whatever the outcome", () => {
    const log: MutationLogEntry[] = [{ at: NOW - HOUR, chars: 900 }, { at: NOW - 10, chars: 1 }];
    const verdict = checkMutation(log, 500, limits, NOW);
    expect(verdict.allowed).toBe(true);
    expect(verdict.log).toEqual([{ at: NOW - 10, chars: 1 }, { at: NOW, chars: 500 }]);
  });

  it("refuses at the per-minute cap and says when the oldest edit in the minute ages out", () => {
    const log = [NOW - 50_000, NOW - 20_000, NOW - 10_000].map((at) => ({ at, chars: 1 }));
    const verdict = checkMutation(log, 1, limits, NOW);
    expect(verdict.allowed).toBe(false);
    expect(verdict).toMatchObject({ message: expect.stringContaining("fits in 10 seconds") });
    expect(verdict.log).toEqual(log);
  });

  it("refuses past the hourly budget and says when enough characters free up", () => {
    const log = [
      { at: NOW - 50 * MINUTE, chars: 300 },
      { at: NOW - 40 * MINUTE, chars: 300 },
      { at: NOW - 30 * MINUTE, chars: 300 },
    ];
    // 900 used + 500 = 1400; freeing the first entry leaves 1100, the second 800.
    const verdict = checkMutation(log, 500, limits, NOW);
    expect(verdict).toMatchObject({ allowed: false, message: expect.stringContaining(`fits in ${20 * 60} seconds`) });
  });

  it("allows a mutation that lands exactly on the hourly budget", () => {
    expect(checkMutation([{ at: NOW - MINUTE, chars: 600 }], 400, limits, NOW).allowed).toBe(true);
  });

  it("refuses an edit larger than the whole hourly budget, since waiting cannot help", () => {
    const verdict = checkMutation([], 1001, limits, NOW);
    expect(verdict).toMatchObject({ allowed: false, message: expect.stringContaining("Split it") });
  });

  it("reads an unsorted log in time order", () => {
    const log = [NOW - 10_000, NOW - 50_000, NOW - 20_000].map((at) => ({ at, chars: 1 }));
    expect(checkMutation(log, 1, limits, NOW)).toMatchObject({ message: expect.stringContaining("fits in 10 seconds") });
  });
});
