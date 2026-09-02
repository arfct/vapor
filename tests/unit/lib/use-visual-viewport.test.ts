// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVisualViewport } from "~/lib/useVisualViewport";

class FakeViewport extends EventTarget {
  height = 700;
  offsetTop = 0;
  scale = 1;
}

describe("useVisualViewport", () => {
  let viewport: FakeViewport;
  const original = window.visualViewport;

  beforeEach(() => {
    viewport = new FakeViewport();
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    window.scrollTo = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(window, "visualViewport", { value: original, configurable: true });
  });

  it("reports the visible height and offset, and follows the keyboard", () => {
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ height: 700, top: 0 });
    act(() => {
      viewport.height = 400;
      viewport.offsetTop = 55;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ height: 400, top: 55 });
  });

  it("scrolls back to the top when the page itself was scrolled", () => {
    renderHook(() => useVisualViewport());
    act(() => {
      Object.defineProperty(window, "scrollY", { value: 300, configurable: true });
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("leaves a pinch-zoomed page alone", () => {
    renderHook(() => useVisualViewport());
    act(() => {
      viewport.scale = 2;
      Object.defineProperty(window, "scrollY", { value: 300, configurable: true });
      viewport.dispatchEvent(new Event("scroll"));
    });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("returns null where the browser has no visual viewport", () => {
    Object.defineProperty(window, "visualViewport", { value: null, configurable: true });
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toBeNull();
  });
});
