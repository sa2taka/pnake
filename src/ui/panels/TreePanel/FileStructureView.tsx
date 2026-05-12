import { useApp } from "../../state/AppContext";

export function FileStructureView(): JSX.Element {
  const { state, dispatch } = useApp();
  const fs = state.analysis?.fileStructure;
  if (!fs) return <div className="treepanel-empty">No file structure</div>;

  return (
    <ul className="treepanel-list" role="tree" aria-label="File structure">
      <li className="treepanel-row treepanel-row-header">
        <span className="treepanel-row-hint">{fs.header.raw || "(missing header)"}</span>
      </li>
      {fs.bodies.map((body) => (
        <li
          key={body.index}
          className="treepanel-row"
          data-testid={`tree-file-body-${body.index}`}
          onClick={() =>
            dispatch({
              type: "select",
              nodeId: `body:${body.index}`,
              origin: "tree",
            })
          }
        >
          <span className="treepanel-row-id">Body {body.index}</span>
          <span className="treepanel-chip" data-kind="other">
            {body.xref.kind === "table" ? "xref-table" : "xref-stream"}
          </span>
          <span className="treepanel-row-hint">startxref={body.startxrefOffset}</span>
        </li>
      ))}
      {fs.eofMarkers.map((marker, i) => (
        <li key={`eof-${i}`} className="treepanel-row">
          <span className="treepanel-row-id">EOF</span>
          <span className="treepanel-row-hint">@ {marker.start}</span>
        </li>
      ))}
    </ul>
  );
}
