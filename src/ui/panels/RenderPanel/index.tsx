import { PanelHeader } from "../PanelHeader";
import "./RenderPanel.css";

export function RenderPanel(): JSX.Element {
  return (
    <div className="renderpanel" data-testid="render-panel">
      <PanelHeader title="Render" />
      <div className="renderpanel-empty">
        <p>No PDF loaded.</p>
      </div>
    </div>
  );
}
