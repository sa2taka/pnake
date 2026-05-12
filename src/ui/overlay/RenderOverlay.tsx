/**
 * SVG overlay rendered on top of the PDF.js canvas.
 *
 * Each PdfVisualElement becomes an interactive <rect>. Coordinates
 * are translated from PDF user space (bottom-left origin) into SVG
 * space (top-left origin) using the page's MediaBox.
 */

import { useApp } from "../state/AppContext";
import type {
  PdfPageSummary,
  PdfRect,
  PdfVisualElement,
} from "../../shared/ir-types";
import "./RenderOverlay.css";

interface RenderOverlayProps {
  page: PdfPageSummary;
  elements: PdfVisualElement[];
  /** Canvas backing-store size in pixels (already includes scale). */
  pixelSize: { width: number; height: number };
  selectedOperationId?: string;
}

export function RenderOverlay({
  page,
  elements,
  pixelSize,
  selectedOperationId,
}: RenderOverlayProps): JSX.Element {
  const { dispatch } = useApp();
  const userBox = page.boxes.mediaBox;

  // Project from user space to pixel space. We assume PDF.js's default
  // viewport: width/height equal user-space dimensions multiplied by
  // the current scale and rotated as needed. Until rotation lands the
  // mapping is a straight axis flip.
  const scaleX = pixelSize.width / Math.max(1, userBox.w);
  const scaleY = pixelSize.height / Math.max(1, userBox.h);

  function project(rect: PdfRect): PdfRect {
    return {
      x: (rect.x - userBox.x) * scaleX,
      y: pixelSize.height - (rect.y - userBox.y + rect.h) * scaleY,
      w: rect.w * scaleX,
      h: rect.h * scaleY,
    };
  }

  return (
    <svg
      className="render-overlay"
      data-testid="render-overlay"
      viewBox={`0 0 ${pixelSize.width} ${pixelSize.height}`}
      width={pixelSize.width}
      height={pixelSize.height}
      aria-label={`Page ${page.pageNumber} interactive overlay`}
    >
      {elements.map((el) => {
        const projected = project(el.bbox);
        const isSelected = selectedOperationId
          ? el.sourceOperationIds.includes(selectedOperationId)
          : false;
        return (
          <rect
            key={el.id}
            data-testid={`overlay-${el.id}`}
            data-kind={el.kind}
            data-selected={isSelected}
            x={projected.x}
            y={projected.y}
            width={Math.max(1, projected.w)}
            height={Math.max(1, projected.h)}
            tabIndex={0}
            role="button"
            aria-label={
              el.preview ? `${el.kind} ${el.preview}` : `${el.kind} ${el.id}`
            }
            onClick={() =>
              dispatch({
                type: "select",
                nodeId: el.sourceOperationIds[0] ?? el.id,
                origin: "overlay",
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                dispatch({
                  type: "select",
                  nodeId: el.sourceOperationIds[0] ?? el.id,
                  origin: "overlay",
                });
              }
            }}
          >
            <title>
              {el.preview ? `${el.kind} — ${el.preview}` : el.kind}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
