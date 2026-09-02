// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVisualViewportHeight } from "~/lib/useVisualViewport";

class FakeViewport extends EventTarget {
  height = 700;
  offsetTop = 0;
  scale = 1;
}

describe("useVisualViewportHeight", () => {
  let viewport: FakeViewport;
  const original = window.visualViewport;

  beforeEach(() => {
    viewport = new FakeViewport();
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", { value: original, configurable: true });
  });

  it("reports the visual viewport height and follows resizes", () => {
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBe(700);
    act(() => {
      viewport.height = 400;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toBe(400);
  });

  it("scrolls back to the top when the keyboard pushes the page", () => {
    renderHook(() => useVisualViewportHeight());
    act(() => {
      viewport.offsetTop = 300;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("leaves a pinch-zoomed page alone", () => {
    renderHook(() => useVisualViewportHeight());
    act(() => {
      viewport.scale = 2;
      viewport.offsetTop = 300;
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("returns null where the browser has no visual viewport", () => {
    Object.defineProperty(window, "visualViewport", { value: null, configurable: true });
    const { result } = renderHook(() => useVisualViewportHeight());
    expect(result.current).toBeNull();
  });
});
