export interface LayoutItem {
  id: string;
  /** Preferred top, in the rail's coordinate space; non-finite when unknown. */
  anchor: number;
  height: number;
}

/**
 * Vertical positions for comment cards beside a document. Every card wants
 * to sit level with its anchor; cards that would overlap stack downward.
 * The active card is pinned exactly to its anchor, and cards above it give
 * way upward so it never has to move. Cards with no known anchor follow
 * the last anchored one. Returns each id's top.
 */
export function layoutComments(
  items: LayoutItem[],
  activeId: string | null,
  gap = 8,
): Map<string, number> {
  const sorted = [...items]
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => {
      const fa = Number.isFinite(a.anchor);
      const fb = Number.isFinite(b.anchor);
      if (fa && fb && a.anchor !== b.anchor) return a.anchor - b.anchor;
      if (fa !== fb) return fa ? -1 : 1;
      return a.index - b.index;
    });

  // Unknown anchors trail the last known one so they stack after it.
  let lastAnchor = 0;
  for (const item of sorted) {
    if (Number.isFinite(item.anchor)) lastAnchor = item.anchor;
    else item.anchor = lastAnchor;
  }

  const tops = new Array<number>(sorted.length);
  const stackDown = (from: number) => {
    for (let i = from; i < sorted.length; i++) {
      const floor = i === 0 ? -Infinity : tops[i - 1] + sorted[i - 1].height + gap;
      tops[i] = Math.max(sorted[i].anchor, floor);
    }
  };

  const active = activeId === null ? -1 : sorted.findIndex((item) => item.id === activeId);
  if (active === -1) {
    stackDown(0);
  } else {
    tops[active] = sorted[active].anchor;
    for (let i = active - 1; i >= 0; i--) {
      const ceiling = tops[i + 1] - gap - sorted[i].height;
      tops[i] = Math.max(0, Math.min(sorted[i].anchor, ceiling));
    }
    stackDown(active + 1);
  }

  return new Map(sorted.map((item, i) => [item.id, tops[i]]));
}
