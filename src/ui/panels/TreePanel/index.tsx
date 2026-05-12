import { useMemo } from "react";
import { PanelHeader } from "../PanelHeader";
import { useApp } from "../../state/AppContext";
import type { PdfObjectSummary } from "../../../shared/ir-types";
import { ObjectsView } from "./ObjectsView";
import { FileStructureView } from "./FileStructureView";
import { PagesView } from "./PagesView";
import { WarningsView } from "./WarningsView";
import "./TreePanel.css";

export function TreePanel(): JSX.Element {
  const { state } = useApp();
  const objects: PdfObjectSummary[] = useMemo(
    () =>
      state.analysis ? Object.values(state.analysis.objectsIndex) : [],
    [state.analysis],
  );
  const totalLabel = state.analysis
    ? `${objects.length} objects · ${state.analysis.pages.length} pages`
    : undefined;

  return (
    <div className="treepanel" data-testid="tree-panel">
      <PanelHeader
        title={state.treeView.charAt(0).toUpperCase() + state.treeView.slice(1)}
        subtitle={totalLabel}
      />
      {state.status !== "loaded" || !state.analysis ? (
        <EmptyTree />
      ) : state.treeView === "objects" ? (
        <ObjectsView />
      ) : state.treeView === "file" ? (
        <FileStructureView />
      ) : state.treeView === "pages" ? (
        <PagesView />
      ) : state.treeView === "warnings" ? (
        <WarningsView />
      ) : (
        <NotImplementedView />
      )}
    </div>
  );
}

function EmptyTree(): JSX.Element {
  return (
    <div className="treepanel-empty">
      <p>Open a PDF to populate the tree.</p>
    </div>
  );
}

function NotImplementedView(): JSX.Element {
  return (
    <div className="treepanel-empty">
      <p>This view ships in a later phase.</p>
    </div>
  );
}
