import { useApp } from "../../state/AppContext";
import type { FC } from "react";

export const PagesView: FC = () => {
  const { state, dispatch } = useApp();
  const pages = state.document.status === "loaded" ? state.document.analysis.pages : [];
  if (pages.length === 0) {
    return <div className="treepanel-empty">No pages.</div>;
  }
  return (
    <ul className="treepanel-list" role="listbox" aria-label="Pages">
      {pages.map((page) => (
        <li
          key={page.pageNumber}
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
