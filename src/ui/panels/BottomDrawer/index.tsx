import { PanelHeader } from "../PanelHeader";
import "./BottomDrawer.css";

export function BottomDrawer(): JSX.Element {
  return (
    <div className="bottomdrawer" data-testid="bottom-drawer">
      <PanelHeader title="Drawer" subtitle="Raw / Decoded / Trace" />
      <div className="bottomdrawer-empty">
        <p>Selection-specific raw bytes appear here.</p>
      </div>
    </div>
  );
}
