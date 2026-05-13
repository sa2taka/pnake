import { useState, type FC } from "react";
import { Toolbar } from "../panels/Toolbar";
import { TreePanel } from "../panels/TreePanel";
import { RenderPanel } from "../panels/RenderPanel";
import { DetailPanel } from "../panels/DetailPanel";
import { BottomDrawer } from "../panels/BottomDrawer";
import { Splitter } from "./Splitter";
import { useApp } from "../state/AppContext";
import "./Shell.css";

const STORAGE_KEY = "pnake.layout";

type LayoutState = {
  leftW: number;
  rightW: number;
  bottomH: number;
}

function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LayoutState>;
      return { ...defaultLayout, ...parsed };
    }
  } catch {
    // ignore corrupted layout state
  }
  return defaultLayout;
}

const defaultLayout: LayoutState = {
  leftW: 280,
  rightW: 320,
  bottomH: 200,
};

function saveLayout(layout: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore storage failures
  }
}

export const Shell: FC = () => {
  const { state, dispatch } = useApp();
  const [layout, setLayout] = useState<LayoutState>(loadLayout);
  const bottomOpen = state.bottomOpen;

  const update = (patch: Partial<LayoutState>) => {
    setLayout((prev) => {
      const next = { ...prev, ...patch };
      saveLayout(next);
      return next;
    });
  };

  return (
    <div
      className="shell"
      style={{
        gridTemplateColumns: `${layout.leftW}px var(--splitter-w) 1fr var(--splitter-w) ${layout.rightW}px`,
        gridTemplateRows: bottomOpen
          ? `var(--toolbar-h) 1fr var(--splitter-w) ${layout.bottomH}px var(--statusbar-h)`
          : `var(--toolbar-h) 1fr 0 0 var(--statusbar-h)`,
      }}
    >
      <div className="shell-toolbar">
        <Toolbar
          bottomOpen={bottomOpen}
          onToggleBottom={() => dispatch({ type: "toggleBottom" })}
        />
      </div>

      <div className="shell-tree">
        <TreePanel />
      </div>
      <Splitter
        orientation="vertical"
        onDrag={(delta) => update({ leftW: Math.max(180, Math.min(600, layout.leftW + delta)) })}
        onDoubleClick={() => update({ leftW: defaultLayout.leftW })}
      />
      <div className="shell-render">
        <RenderPanel />
      </div>
      <Splitter
        orientation="vertical"
        onDrag={(delta) => update({ rightW: Math.max(220, Math.min(640, layout.rightW - delta)) })}
        onDoubleClick={() => update({ rightW: defaultLayout.rightW })}
      />
      <div className="shell-detail">
        <DetailPanel />
      </div>

      {bottomOpen && (
        <>
          <Splitter
            orientation="horizontal"
            onDrag={(delta) =>
              update({ bottomH: Math.max(120, Math.min(560, layout.bottomH - delta)) })
            }
            onDoubleClick={() => update({ bottomH: defaultLayout.bottomH })}
            spanColumns
          />
          <div className="shell-bottom">
            <BottomDrawer />
          </div>
        </>
      )}

      <div className="shell-status">
        <StatusBar />
      </div>
    </div>
  );
};

const StatusBar: FC = () => {
  const { state } = useApp();
  const a = state.document.status === "loaded" ? state.document.analysis : undefined;
  return (
    <div className="statusbar">
      <span className="statusbar-segment">pnake</span>
      {a ? (
        <>
          <span className="statusbar-segment statusbar-muted">v{a.fileInfo.pdfVersion}</span>
          <span className="statusbar-segment statusbar-muted">
            {formatBytes(a.fileInfo.byteSize)}
          </span>
          <span className="statusbar-segment statusbar-muted">
            {Object.keys(a.objectsIndex).length} objs / {a.pages.length} pages
          </span>
          {a.fileInfo.tagged && <span className="statusbar-segment statusbar-muted">tagged</span>}
          {a.fileInfo.formFields > 0 && (
            <span className="statusbar-segment statusbar-muted">
              {a.fileInfo.formFields} fields
              {a.fileInfo.signatures > 0 && ` / ${a.fileInfo.signatures} sig`}
            </span>
          )}
          {a.warnings.length > 0 && (
            <span className="statusbar-segment statusbar-warning">⚠ {a.warnings.length}</span>
          )}
        </>
      ) : (
        <span className="statusbar-segment statusbar-muted">no file loaded</span>
      )}
      <span className="statusbar-spacer" />
      <span className="statusbar-segment statusbar-muted">⌘B drawer</span>
    </div>
  );
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
