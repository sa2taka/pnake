import { PanelHeader } from "../PanelHeader";
import "./TreePanel.css";

export function TreePanel(): JSX.Element {
  return (
    <div className="treepanel" data-testid="tree-panel">
      <PanelHeader title="Tree" />
      <EmptyTree />
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
