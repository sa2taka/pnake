import { useState } from "react";
import { Toolbar } from "../panels/Toolbar";
import { TreePanel } from "../panels/TreePanel";
import { RenderPanel } from "../panels/RenderPanel";
import { DetailPanel } from "../panels/DetailPanel";
import { BottomDrawer } from "../panels/BottomDrawer";
import { Splitter } from "./Splitter";
import "./Shell.css";

const STORAGE_KEY = "pnake.layout";

interface LayoutState {
  leftW: number;
  rightW: number;
  bottomH: number;
  bottomOpen: boolean;
}

function loadLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultLayout, ...JSON.parse(raw) };
  } catch {
    // ignore corrupted layout state
  }
  return defaultLayout;
}

const defaultLayout: LayoutState = {
  leftW: 280,
  rightW: 320,
  bottomH: 200,
  bottomOpen: false,
};

function saveLayout(layout: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore storage failures
  }
}

export function Shell(): JSX.Element {
  const [layout, setLayout] = useState<LayoutState>(loadLayout);

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
        gridTemplateRows: layout.bottomOpen
          ? `var(--toolbar-h) 1fr var(--splitter-w) ${layout.bottomH}px var(--statusbar-h)`
          : `var(--toolbar-h) 1fr 0 0 var(--statusbar-h)`,
      }}
    >
      <div className="shell-toolbar">
        <Toolbar
          bottomOpen={layout.bottomOpen}
          onToggleBottom={() => update({ bottomOpen: !layout.bottomOpen })}
        />
      </div>

      <div className="shell-tree">
        <TreePanel />
      </div>
      <Splitter
        orientation="vertical"
        onDrag={(delta) =>
          update({ leftW: Math.max(180, Math.min(600, layout.leftW + delta)) })
        }
        onDoubleClick={() => update({ leftW: defaultLayout.leftW })}
      />
      <div className="shell-render">
        <RenderPanel />
      </div>
      <Splitter
        orientation="vertical"
        onDrag={(delta) =>
          update({ rightW: Math.max(220, Math.min(640, layout.rightW - delta)) })
        }
        onDoubleClick={() => update({ rightW: defaultLayout.rightW })}
      />
      <div className="shell-detail">
        <DetailPanel />
      </div>

      {layout.bottomOpen && (
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
}

function StatusBar(): JSX.Element {
  return (
    <div className="statusbar">
      <span className="statusbar-segment">pnake</span>
      <span className="statusbar-segment statusbar-muted">no file loaded</span>
      <span className="statusbar-spacer" />
      <span className="statusbar-segment statusbar-muted">⌘B drawer</span>
    </div>
  );
}
