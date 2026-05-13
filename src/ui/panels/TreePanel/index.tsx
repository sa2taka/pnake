import { useMemo, type FC } from "react";
import { PanelHeader } from "../PanelHeader";
import { useApp } from "../../state/AppContext";
import { ObjectsView } from "./ObjectsView";
import { FileStructureView } from "./FileStructureView";
import { PagesView } from "./PagesView";
import { WarningsView } from "./WarningsView";
import { ContentView } from "./ContentView";
import { StructureView } from "./StructureView";
import type { PdfObjectSummary } from "../../../shared/ir-types";
import "./TreePanel.css";

export const TreePanel: FC = () => {
  const { state } = useApp();
  const analysis = state.document.status === "loaded" ? state.document.analysis : undefined;
  const objects: PdfObjectSummary[] = useMemo(
    () => (analysis ? Object.values(analysis.objectsIndex) : []),
    [analysis],
  );
  const totalLabel = analysis
    ? `${objects.length} objects · ${analysis.pages.length} pages`
    : undefined;

  return (
    <div className="treepanel" data-testid="tree-panel">
      <PanelHeader
        title={state.treeView.charAt(0).toUpperCase() + state.treeView.slice(1)}
        subtitle={totalLabel}
      />
      {!analysis ? (
        <EmptyTree />
      ) : state.treeView === "objects" ? (
        <ObjectsView />
      ) : state.treeView === "file" ? (
        <FileStructureView />
      ) : state.treeView === "pages" ? (
        <PagesView />
      ) : state.treeView === "content" ? (
        <ContentView />
      ) : state.treeView === "structure" ? (
        <StructureView />
      ) : state.treeView === "warnings" ? (
        <WarningsView />
      ) : (
        <NotImplementedView />
      )}
    </div>
  );
};

const EmptyTree: FC = () => (
  <div className="treepanel-empty">
    <p>Open a PDF to populate the tree.</p>
  </div>
);

const NotImplementedView: FC = () => (
  <div className="treepanel-empty">
    <p>This view ships in a later phase.</p>
  </div>
);
