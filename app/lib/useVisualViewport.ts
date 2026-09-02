import { useEffect, useState } from "react";

export interface VisualViewportRect {
  /** Visible height in px. */
  height: number;
  /** Offset of the visible area from the layout viewport's top, in px. */
  top: number;
}

/**
 * The part of the page the visitor can actually see, or null before mount
 * and where the browser doesn't report one.
 *
 * Mobile browsers don't shrink the layout viewport for the on-screen
 * keyboard. iOS Safari shifts the layout viewport up instead — even when
 * the document can't scroll — which carries a `fixed` header off screen
 * and leaves a `bottom: 0` sheet behind the keys. A fixed shell placed at
 * `top` and sized to `height` stays exactly over the visible area. Any
 * real document scroll is reset too; pinch-zoom is left alone.
 */
export function useVisualViewport(): VisualViewportRect | null {
  const [rect, setRect] = useState<VisualViewportRect | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      setRect({ height: viewport.height, top: viewport.offsetTop });
      if (viewport.scale === 1 && window.scrollY !== 0) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return rect;
}
