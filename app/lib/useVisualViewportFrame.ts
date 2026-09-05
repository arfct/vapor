import { useEffect, type RefObject } from "react";

/**
 * Pin a fixed layer to the visual viewport.
 *
 * iOS Safari keeps `100dvh` at full height while the software keyboard is
 * up and shrinks only `visualViewport` — sometimes `innerHeight` too,
 * sometimes not. A fixed layer sized by `dvh` would run on under the
 * keyboard, and when Safari pans the page to reveal a caret or a focused
 * input the layer's top would leave the screen with it.
 *
 * Sizing the layer from the visual viewport, and translating it by Safari's
 * pan, keeps whatever is anchored to its top and bottom (the header, the
 * comment sheet) on screen. At 1:1 scale on desktop this equals `100dvh`,
 * so nothing changes there; pinch-zoom (scale ≠ 1) falls back to the
 * stylesheet.
 */
export function useVisualViewportFrame(
  layerRef: RefObject<HTMLElement | null>,
  onKeyboardChange?: (keyboardUp: boolean) => void,
) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const layer = layerRef.current;
    if (!viewport || !layer) return;

    let keyboardUp = false;
    // The stylesheet height (`100dvh`) stands in for the full height the
    // keyboard has taken a bite out of. Measured on resize only: scroll
    // events arrive every frame and must not force layout.
    let fullHeight = 0;
    const measureFullHeight = () => {
      layer.style.height = "";
      fullHeight = layer.getBoundingClientRect().height;
    };
    const apply = () => {
      const wasUp = keyboardUp;
      // A hidden tab can report a zero-height viewport; leave the stylesheet in charge then.
      if (viewport.scale === 1 && viewport.height > 0) {
        if (fullHeight === 0) measureFullHeight();
        layer.style.height = `${viewport.height}px`;
        layer.style.transform = viewport.offsetTop > 0 ? `translateY(${viewport.offsetTop}px)` : "";
        keyboardUp = viewport.height < fullHeight - 1;
      } else {
        layer.style.height = "";
        layer.style.transform = "";
        keyboardUp = false;
      }
      if (keyboardUp !== wasUp) onKeyboardChange?.(keyboardUp);
    };
    const onResize = () => {
      measureFullHeight();
      apply();
    };

    viewport.addEventListener("resize", onResize);
    viewport.addEventListener("scroll", apply);
    window.addEventListener("resize", onResize);
    onResize();
    return () => {
      viewport.removeEventListener("resize", onResize);
      viewport.removeEventListener("scroll", apply);
      window.removeEventListener("resize", onResize);
      layer.style.height = "";
      layer.style.transform = "";
    };
  }, [layerRef, onKeyboardChange]);
}
