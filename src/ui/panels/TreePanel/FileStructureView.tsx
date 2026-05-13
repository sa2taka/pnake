import type { FC } from "react";
import { useApp } from "../../state/AppContext";
import { useListboxNav } from "../../hooks/useListboxNav";

export const FileStructureView: FC = () => {
  const { state, dispatch } = useApp();
  const fs = state.document.status === "loaded" ? state.document.analysis.fileStructure : undefined;
  // Only body rows are selectable. EOF markers and the header line are
  // informational and shouldn't participate in keyboard navigation.
  const bodyIds = fs ? fs.bodies.map((b) => `body:${b.index}`) : [];
  const onKeyDown = useListboxNav({
    ids: bodyIds,
    selectedId: state.selectedNodeId,
    onSelect: (id) => dispatch({ type: "select", nodeId: id, origin: "tree" }),
  });

  if (!fs) return <div className="treepanel-empty">No file structure</div>;

  return (
    <ul
      className="treepanel-list"
      role="listbox"
      aria-label="File structure"
      aria-activedescendant={state.selectedNodeId}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <li className="treepanel-row treepanel-row-header">
        <span className="treepanel-row-hint">{fs.header.raw || "(missing header)"}</span>
      </li>
      {fs.bodies.map((body) => {
        const id = `body:${body.index}`;
        return (
          <li
            key={body.index}
            id={id}
            role="option"
            aria-selected={state.selectedNodeId === id}
            tabIndex={-1}
            className="treepanel-row"
            data-selected={state.selectedNodeId === id}
            data-testid={`tree-file-body-${body.index}`}
            onClick={() => dispatch({ type: "select", nodeId: id, origin: "tree" })}
          >
            <span className="treepanel-row-id">Body {body.index}</span>
            <span className="treepanel-chip" data-kind="other">
              {body.xref.kind === "table" ? "xref-table" : "xref-stream"}
            </span>
            <span className="treepanel-row-hint">startxref={body.startxrefOffset}</span>
          </li>
        );
      })}
      {fs.eofMarkers.map((marker, i) => (
        <li key={`eof-${i}`} className="treepanel-row">
          <span className="treepanel-row-id">EOF</span>
          <span className="treepanel-row-hint">@ {marker.start}</span>
        </li>
      ))}
    </ul>
  );
};
