import { useEffect, useRef, useState } from "react";
import { PanelHeader } from "../PanelHeader";
import { useApp } from "../../state/AppContext";
import { renderPage } from "../../../pdfjs/renderer";
import { RenderOverlay } from "../../overlay/RenderOverlay";
import type { PageOperationsResult } from "../../../shared/protocol";
import "./RenderPanel.css";

export function RenderPanel(): JSX.Element {
  const { state, parser } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string>("");
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [pageOps, setPageOps] = useState<PageOperationsResult | null>(null);

  // Render the page on canvas whenever the file or page changes.
  useEffect(() => {
    const bytes = state.fileBytes;
    if (!bytes || !canvasRef.current) {
      setStatus("");
      return;
    }
    setStatus("rendering…");
    setPageSize(null);
    let cancelled = false;
    void renderPage({
      bytes,
      pageNumber: state.currentPage,
      canvas: canvasRef.current,
      scale: 1,
    })
      .then((info) => {
        if (cancelled) return;
        setStatus("");
        setPageSize({ width: info.width, height: info.height });
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [state.fileBytes, state.currentPage]);

  // Fetch the page operations + visual elements separately so the
  // overlay can render the moment the canvas is ready.
  useEffect(() => {
    if (state.status !== "loaded") return;
    let cancelled = false;
    setPageOps(null);
    parser
      .getPageOperations(state.currentPage)
      .then((r) => {
        if (!cancelled) setPageOps(r);
      })
      .catch(() => {
        if (!cancelled) setPageOps(null);
      });
    return () => {
      cancelled = true;
    };
  }, [state.status, state.currentPage, parser]);

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
