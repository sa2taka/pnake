import { useRef } from "react";
import { useApp, type TreeViewMode } from "../state/AppContext";
import "./Toolbar.css";

interface ToolbarProps {
  bottomOpen: boolean;
  onToggleBottom: () => void;
}

const VIEW_MODES: { value: TreeViewMode; label: string }[] = [
  { value: "file", label: "File" },
  { value: "objects", label: "Objects" },
  { value: "pages", label: "Pages" },
  { value: "resources", label: "Resources" },
  { value: "content", label: "Content" },
  { value: "structure", label: "Structure" },
  { value: "warnings", label: "Warnings" },
];

export function Toolbar({ bottomOpen, onToggleBottom }: ToolbarProps): JSX.Element {
  const { state, dispatch, parser } = useApp();
  const inputRef = useRef<HTMLInputElement>(null);

  const loadFromFile = async (file: File) => {
    dispatch({ type: "loadStart", fileName: file.name });
    try {
      const buffer = await file.arrayBuffer();
      // Keep a copy for PDF.js — parser.load() may transfer the original buffer.
      const rendererCopy = buffer.slice(0);
      const { analysis, structTree } = await parser.load(buffer, file.name);
      dispatch({
        type: "loadSuccess",
        analysis,
        structTree,
        fileName: file.name,
        fileBytes: rendererCopy,
      });
    } catch (err) {
      dispatch({
        type: "loadError",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void loadFromFile(file);
    event.target.value = "";
  };

  const onPick = () => inputRef.current?.click();

  const warningCount = state.analysis?.warnings.length ?? 0;

  return (
    <div className="toolbar" role="toolbar" aria-label="Application toolbar">
      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-action"
          onClick={onPick}
          aria-label="Open a PDF file"
        >
          Open PDF
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={onFileChange}
          hidden
          data-testid="file-input"
        />
        {state.fileName && (
          <span className="toolbar-filename" title={state.fileName}>
            {state.fileName}
          </span>
        )}
        {state.status === "loading" && (
          <span className="toolbar-status" role="status" aria-live="polite">
            loading…
          </span>
        )}
        {state.status === "error" && (
          <span
            className="toolbar-status toolbar-status-error"
            role="alert"
            aria-live="assertive"
          >
            {state.error}
          </span>
        )}
      </div>

      <div className="toolbar-group">
        <span className="toolbar-label">View</span>
        <select
          className="toolbar-select"
          value={state.treeView}
          onChange={(e) =>
            dispatch({ type: "setTreeView", mode: e.target.value as TreeViewMode })
          }
          disabled={state.status !== "loaded"}
        >
          {VIEW_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {state.analysis && state.analysis.pages.length > 0 && (
        <div className="toolbar-group">
          <span className="toolbar-label">Page</span>
          <button
            type="button"
            className="toolbar-action"
            aria-label="Previous page"
            onClick={() =>
              dispatch({
                type: "setCurrentPage",
                pageNumber: Math.max(1, state.currentPage - 1),
              })
            }
          >
            ‹
          </button>
          <span className="toolbar-status" data-testid="toolbar-page">
            {state.currentPage} / {state.analysis.pages.length}
          </span>
          <button
            type="button"
            className="toolbar-action"
            aria-label="Next page"
            onClick={() =>
              dispatch({
                type: "setCurrentPage",
                pageNumber: Math.min(
                  state.analysis!.pages.length,
                  state.currentPage + 1,
                ),
              })
            }
          >
            ›
          </button>
        </div>
      )}

      <span className="toolbar-flex" />

      {warningCount > 0 && (
        <div className="toolbar-group">
          <button
            type="button"
            className="toolbar-action toolbar-warning"
            onClick={() => dispatch({ type: "setTreeView", mode: "warnings" })}
            aria-label={`${warningCount} warnings`}
          >
            ⚠ {warningCount}
          </button>
        </div>
      )}

      <div className="toolbar-group">
        <button
          type="button"
          className="toolbar-action"
          aria-pressed={bottomOpen}
          onClick={onToggleBottom}
          title="Toggle drawer (B)"
        >
          {bottomOpen ? "Hide drawer" : "Show drawer"}
        </button>
      </div>
    </div>
  );
}
