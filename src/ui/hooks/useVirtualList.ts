/**
 * Minimal viewport-based virtualization for fixed-height lists.
 *
 * 80 lines, no dependency. The devtools-aesthetic skill flags
 * non-virtualized lists as a likely performance trap for trees with
 * 10000+ rows; this hook is what we reach for there.
 */

import { useEffect, useRef, useState } from "react";

export type VirtualRange = {
  start: number;
  end: number;
}

export type UseVirtualListResult<E extends HTMLElement = HTMLElement> = {
  containerRef: React.RefObject<E | null>;
  range: VirtualRange;
  totalHeight: number;
}

export function useVirtualList<E extends HTMLElement = HTMLElement>(
  itemCount: number,
  rowHeight: number,
  overscan = 8,
): UseVirtualListResult<E> {
  const containerRef = useRef<E | null>(null);
  const [range, setRange] = useState<VirtualRange>(() => ({
    start: 0,
    end: Math.min(itemCount, 40),
  }));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const top = el.scrollTop;
      const height = el.clientHeight;
      const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
      const end = Math.min(itemCount, Math.ceil((top + height) / rowHeight) + overscan);
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [itemCount, rowHeight, overscan]);

  return {
    containerRef,
    range,
    totalHeight: itemCount * rowHeight,
  };
}
