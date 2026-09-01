// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIdleSleep, IDLE_SLEEP_MS, HIDDEN_SLEEP_MS } from "~/lib/useIdleSleep";

describe("useIdleSleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts awake and sleeps after the idle window", () => {
    const { result } = renderHook(() => useIdleSleep());
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(IDLE_SLEEP_MS + 1);
    });
    expect(result.current).toBe(true);
  });

  it("activity resets the idle timer and wakes a sleeping tab", () => {
    const { result } = renderHook(() => useIdleSleep());
    act(() => {
      vi.advanceTimersByTime(IDLE_SLEEP_MS + 1);
    });
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("keydown"));
    });
    expect(result.current).toBe(false);

    // Activity keeps re-arming: half the window, activity, half again — still awake
    act(() => {
      vi.advanceTimersByTime(IDLE_SLEEP_MS / 2);
      window.dispatchEvent(new Event("pointermove"));
      vi.advanceTimersByTime(IDLE_SLEEP_MS / 2);
    });
    expect(result.current).toBe(false);
  });

  it("sleeps a minute after the page is hidden", () => {
    const { result } = renderHook(() => useIdleSleep());

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(HIDDEN_SLEEP_MS + 1);
    });
    expect(result.current).toBe(true);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(false);
  });
});
