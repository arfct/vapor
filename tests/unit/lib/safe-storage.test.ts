// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readStorage, writeStorage, removeStorage } from "~/lib/safe-storage";

const KEY = "safe-storage-test";

describe("safe storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("round-trips a value and removes it", () => {
    expect(readStorage(KEY)).toBeNull();
    writeStorage(KEY, "hello");
    expect(readStorage(KEY)).toBe("hello");
    removeStorage(KEY);
    expect(readStorage(KEY)).toBeNull();
  });

  it("returns null when getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readStorage(KEY)).toBeNull();
  });

  it("swallows setItem and removeItem failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(() => writeStorage(KEY, "x")).not.toThrow();
    expect(() => removeStorage(KEY)).not.toThrow();
  });

  it("tolerates the localStorage accessor itself throwing", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    try {
      expect(readStorage(KEY)).toBeNull();
      expect(() => writeStorage(KEY, "x")).not.toThrow();
      expect(() => removeStorage(KEY)).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });

  it("is a no-op without a window (SSR)", () => {
    vi.stubGlobal("window", undefined);
    expect(readStorage(KEY)).toBeNull();
    expect(() => writeStorage(KEY, "x")).not.toThrow();
    expect(() => removeStorage(KEY)).not.toThrow();
  });
});
