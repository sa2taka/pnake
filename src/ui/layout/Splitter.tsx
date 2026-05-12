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
      role="separator"
      aria-orientation={orientation}
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
