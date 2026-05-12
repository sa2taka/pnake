import { useEffect, useRef, useState } from "react";
import { PanelHeader } from "../PanelHeader";
import { useApp } from "../../state/AppContext";
import { renderPage } from "../../../pdfjs/renderer";
import "./RenderPanel.css";

export function RenderPanel(): JSX.Element {
  const { state } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<string>("");
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);

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
        setPageSize({ w: info.width, h: info.height });
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [state.fileBytes, state.currentPage]);

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
        <canvas
          ref={canvasRef}
          data-testid="render-canvas"
          aria-label={
            pageSize ? `Page ${state.currentPage}, ${pageSize.w}×${pageSize.h}` : "PDF page"
          }
        />
      </div>
    </div>
  );
}
