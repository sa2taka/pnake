/**
 * SVG overlay rendered on top of the PDF.js canvas.
 *
 * Each PdfVisualElement becomes an interactive <rect>. Coordinates are
 * translated from PDF user space (bottom-left origin, possibly rotated)
 * into SVG space (top-left origin) using the page's MediaBox and Rotate.
 *
 * Elements are sorted by zIndex before painting so a click on overlapping
 * regions lands on the visually-top element (the higher z wins via SVG's
 * later-in-document-order paint rule).
 */

import { useMemo, type FC } from "react";
import { useApp } from "../state/AppContext";
import type { PdfPageSummary, PdfRect, PdfVisualElement } from "../../shared/ir-types";
import "./RenderOverlay.css";

type RenderOverlayProps = {
  page: PdfPageSummary;
  elements: PdfVisualElement[];
  /** Canvas backing-store size in pixels (already includes scale). */
  pixelSize: { width: number; height: number };
  selectedOperationId?: string;
};

export const RenderOverlay: FC<RenderOverlayProps> = ({
  page,
  elements,
  pixelSize,
  selectedOperationId,
}) => {
  const { dispatch } = useApp();
  const userBox = page.boxes.mediaBox;
  const rotation = page.rotation;

  // Sort elements by zIndex so painting order matches the visual stack.
  const ordered = useMemo(() => [...elements].sort((a, b) => a.zIndex - b.zIndex), [elements]);

  const project = useMemo(
    () => makeProjector(userBox, pixelSize, rotation),
    [userBox, pixelSize, rotation],
  );

  return (
    <svg
      className="render-overlay"
      data-testid="render-overlay"
      viewBox={`0 0 ${pixelSize.width} ${pixelSize.height}`}
      width={pixelSize.width}
      height={pixelSize.height}
      aria-label={`Page ${page.pageNumber} interactive overlay`}
    >
      {ordered.map((el) => {
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
            aria-label={el.preview ? `${el.kind} ${el.preview}` : `${el.kind} ${el.id}`}
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
            <title>{el.preview ? `${el.kind} — ${el.preview}` : el.kind}</title>
          </rect>
        );
      })}
    </svg>
  );
};

/**
 * Build a projector from PDF user-space to SVG pixel space that respects
 * page /Rotate. PDF.js's canvas viewport pre-rotates the page, so SVG
 * needs the same handedness change for overlay rects to align.
 *
 * Strategy: corner-transform the user rectangle into the rotated frame,
 * then scale to pixel space. We don't use a single affine matrix because
 * the rotation reshapes the bounding box (axis swap for 90 / 270), and
 * the per-corner approach keeps the math obvious.
 */
function makeProjector(
  userBox: PdfRect,
  pixelSize: { width: number; height: number },
  rotation: 0 | 90 | 180 | 270,
): (rect: PdfRect) => PdfRect {
  // Dimensions of the page after PDF.js applies /Rotate.
  const rotatedWidth = rotation === 90 || rotation === 270 ? userBox.h : userBox.w;
  const rotatedHeight = rotation === 90 || rotation === 270 ? userBox.w : userBox.h;
  const scaleX = pixelSize.width / Math.max(1, rotatedWidth);
  const scaleY = pixelSize.height / Math.max(1, rotatedHeight);

  function userToRotated(x: number, y: number): { x: number; y: number } {
    // Translate to mediaBox-origin frame.
    const ux = x - userBox.x;
    const uy = y - userBox.y;
    switch (rotation) {
      case 0:
        // PDF up = SVG down. Y flips after scaling below.
        return { x: ux, y: userBox.h - uy };
      case 90:
        return { x: uy, y: ux };
      case 180:
        return { x: userBox.w - ux, y: uy };
      case 270:
        return { x: userBox.h - uy, y: userBox.w - ux };
    }
  }

  return (rect) => {
    // Transform all four corners and take the axis-aligned bbox in
    // rotated space — robust against negative-width PDF rects and
    // rotations that swap orientation.
    const corners = [
      userToRotated(rect.x, rect.y),
      userToRotated(rect.x + rect.w, rect.y),
      userToRotated(rect.x, rect.y + rect.h),
      userToRotated(rect.x + rect.w, rect.y + rect.h),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs);
    const y1 = Math.max(...ys);
    return {
      x: x0 * scaleX,
      y: y0 * scaleY,
      w: (x1 - x0) * scaleX,
      h: (y1 - y0) * scaleY,
    };
  };
}
