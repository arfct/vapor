import { useEffect, useState } from "react";

/**
 * Height in px of the part of the page the visitor can actually see, or
 * null before mount and where the browser doesn't report one.
 *
 * Mobile browsers don't shrink the layout viewport for the on-screen
 * keyboard: they scroll it, which carries a `fixed` header off screen and
 * leaves a `bottom: 0` sheet behind the keys. Sizing the app shell to the
 * visual viewport and holding the page scroll at the top keeps the header
 * in place and the sheet above the keyboard. Pinch-zoom is left alone.
 */
export function useVisualViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      setHeight(viewport.height);
      const scrolled = window.scrollY !== 0 || viewport.offsetTop !== 0;
      if (viewport.scale === 1 && scrolled) window.scrollTo(0, 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return height;
}
