import { useEffect, useRef, useState } from "react";
import { PanelHeader } from "../PanelHeader";
import { useApp } from "../../state/AppContext";
import { renderPageWithHandle } from "../../../pdfjs/renderer";
import { RenderOverlay } from "../../overlay/RenderOverlay";
import "./RenderPanel.css";

export function RenderPanel(): JSX.Element {
  const { state } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string>("");
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const pageOps = state.pageOperations;

  // Render the page on canvas whenever the file or page changes.
  // renderPageWithHandle gives us a cancel() that aborts the in-flight
  // PDF.js render task, so rapid page navigation doesn't paint stale frames.
  useEffect(() => {
    const bytes = state.fileBytes;
    if (!bytes || !canvasRef.current) {
      setStatus("");
      return;
    }
    setStatus("rendering…");
    setPageSize(null);
    const handle = renderPageWithHandle({
      bytes,
      pageNumber: state.currentPage,
      canvas: canvasRef.current,
      scale: 1,
    });
    let cancelled = false;
    handle.result
      .then((info) => {
        if (cancelled) return;
        setStatus("");
        setPageSize({ width: info.width, height: info.height });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [state.fileBytes, state.currentPage]);

  const currentPage = state.analysis?.pages[state.currentPage - 1];

  return (
    <div className="renderpanel" data-testid="render-panel">
      <PanelHeader
        title="Render"
        subtitle={
          state.analysis
            ? `Page ${state.currentPage} / ${state.analysis.pages.length}`
            : undefined
        }
      />
      <div className="renderpanel-canvas-wrap">
        {!state.fileBytes && (
          <p className="renderpanel-empty">Open a PDF to render its pages.</p>
        )}
        {status && (
          <p className="renderpanel-status" role="status">
            {status}
          </p>
        )}
        <div className="renderpanel-stack">
          <canvas
            ref={canvasRef}
            data-testid="render-canvas"
            aria-label={
              pageSize ? `Page ${state.currentPage}, ${pageSize.width}×${pageSize.height}` : "PDF page"
            }
          />
          {currentPage && pageSize && pageOps && (
            <RenderOverlay
              page={currentPage}
              elements={pageOps.visualElements}
              pixelSize={pageSize}
              selectedOperationId={
                state.selectedNodeId?.startsWith("page:")
                  ? state.selectedNodeId
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
