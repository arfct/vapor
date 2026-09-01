import { useRef, useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";

export default function OnboardingBanner() {
  const { isOnboarding, clearDocument } = useDocument();
  const spanRef = useRef<HTMLSpanElement>(null);
  const [offset, setOffset] = useState<number | null>(null);

  useEffect(() => {
    const el = spanRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.offsetWidth;
      if (w > 0) setOffset(w);
    };
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isOnboarding]);

  if (!isOnboarding) return null;

  return (
    <button
      onClick={clearDocument}
      className="marquee-btn h-full cursor-pointer overflow-hidden text-sm uppercase tracking-wider text-emerald-600 transition-colors hover:bg-emerald-500 hover:text-white"
    >
      <span
        className="inline-flex whitespace-nowrap"
        style={
          offset
            ? ({ "--marquee-offset": `-${offset}px`, animation: "marquee 4s linear infinite" } as React.CSSProperties)
            : undefined
        }
      >
        <span ref={spanRef} className="pr-[1.5em]">start editing</span>
        <span className="pr-[1.5em]">start editing</span>
      </span>
    </button>
  );
}
