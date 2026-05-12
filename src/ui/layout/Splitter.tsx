import { useCallback, useEffect, useRef, useState } from "react";

interface SplitterProps {
  orientation: "vertical" | "horizontal";
  onDrag: (delta: number) => void;
  onDoubleClick?: () => void;
  spanColumns?: boolean;
}

export function Splitter({
  orientation,
  onDrag,
  onDoubleClick,
  spanColumns = false,
}: SplitterProps): JSX.Element {
  const [active, setActive] = useState(false);
  const lastRef = useRef<number | null>(null);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (lastRef.current == null) return;
      const current = orientation === "vertical" ? event.clientX : event.clientY;
      const delta = current - lastRef.current;
      lastRef.current = current;
      if (delta !== 0) onDrag(delta);
    },
    [onDrag, orientation],
  );

  const onPointerUp = useCallback(() => {
    lastRef.current = null;
    setActive(false);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  useEffect(() => () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove, onPointerUp]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    lastRef.current = orientation === "vertical" ? event.clientX : event.clientY;
    setActive(true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <div
      // No role="separator": that role implies a focusable resize affordance
      // with aria-valuenow / arrow-key support, which we do not implement.
      // The element remains a draggable visual divider — pointer-only by
      // design until we add a keyboard mode.
      aria-hidden="true"
      className={
        orientation === "vertical"
          ? "splitter-v"
          : `splitter-h ${spanColumns ? "splitter-span-cols" : ""}`.trim()
      }
      data-active={active}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
