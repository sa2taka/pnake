import "./Toolbar.css";

interface ToolbarProps {
  bottomOpen: boolean;
  onToggleBottom: () => void;
}

export function Toolbar({ bottomOpen, onToggleBottom }: ToolbarProps): JSX.Element {
  return (
    <div className="toolbar" role="toolbar" aria-label="Application toolbar">
      <div className="toolbar-group">
        <button type="button" className="toolbar-action" disabled>
          Open PDF
        </button>
        <span className="toolbar-spacer" />
      </div>
      <div className="toolbar-group">
        <span className="toolbar-label">View</span>
        <select className="toolbar-select" disabled defaultValue="objects">
          <option value="file">File</option>
          <option value="objects">Objects</option>
          <option value="pages">Pages</option>
          <option value="resources">Resources</option>
          <option value="content">Content</option>
          <option value="structure">Structure</option>
          <option value="warnings">Warnings</option>
        </select>
      </div>
      <span className="toolbar-flex" />
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
