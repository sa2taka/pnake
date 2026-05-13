import type { FC } from "react";
import { useApp } from "../../state/AppContext";
import { useListboxNav } from "../../hooks/useListboxNav";

export const PagesView: FC = () => {
  const { state, dispatch } = useApp();
  const pages = state.document.status === "loaded" ? state.document.analysis.pages : [];
  const ids = pages.map((p) => p.objectRef);
  const onKeyDown = useListboxNav({
    ids,
    selectedId: state.selectedNodeId,
    onSelect: (id) => dispatch({ type: "select", nodeId: id, origin: "tree" }),
  });

  if (pages.length === 0) {
    return <div className="treepanel-empty">No pages.</div>;
  }
  return (
    <ul
      className="treepanel-list"
      role="listbox"
      aria-label="Pages"
      aria-activedescendant={state.selectedNodeId}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {pages.map((page) => (
        <li
          key={page.pageNumber}
          id={page.objectRef}
          role="option"
          aria-selected={state.selectedNodeId === page.objectRef}
          tabIndex={-1}
          className="treepanel-row"
          data-selected={state.selectedNodeId === page.objectRef}
          onClick={() => dispatch({ type: "select", nodeId: page.objectRef, origin: "tree" })}
        >
          <span className="treepanel-row-id">Page {page.pageNumber}</span>
          <span className="treepanel-chip" data-kind="page">
            {`${Math.round(page.boxes.mediaBox.w)}×${Math.round(page.boxes.mediaBox.h)}`}
          </span>
          <span className="treepanel-row-hint">{page.objectRef}</span>
        </li>
      ))}
    </ul>
  );
};
