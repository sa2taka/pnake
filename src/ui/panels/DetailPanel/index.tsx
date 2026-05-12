import { PanelHeader } from "../PanelHeader";
import "./DetailPanel.css";

export function DetailPanel(): JSX.Element {
  return (
    <div className="detailpanel" data-testid="detail-panel">
      <PanelHeader title="Detail" />
      <div className="detailpanel-empty">
        <p>Select a node to see its details.</p>
      </div>
    </div>
  );
}
