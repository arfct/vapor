// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "~/lib/useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to auto when nothing is stored", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("auto");
    expect(document.documentElement.getAttribute("data-theme")).toBe("auto");
  });

  it("restores a stored theme after hydration", () => {
    localStorage.setItem("vapor-theme", "dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("setTheme persists and applies the theme", () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme("light");
    });
    expect(result.current.theme).toBe("light");
    expect(localStorage.getItem("vapor-theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("resolves to auto when storage throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("auto");
  });

  it("still switches theme when storage throws on write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setTheme("dark");
    });
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
