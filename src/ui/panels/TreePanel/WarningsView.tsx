import type { FC } from "react";
import { useApp } from "../../state/AppContext";
import { useListboxNav } from "../../hooks/useListboxNav";
import type { PdfWarning } from "../../../shared/ir-types";

export const WarningsView: FC = () => {
  const { state, dispatch } = useApp();
  const warnings = state.document.status === "loaded" ? state.document.analysis.warnings : [];
  const ids = warnings.map((w) => w.id);
  const onKeyDown = useListboxNav({
    ids,
    selectedId: state.selectedNodeId,
    onSelect: (id) => dispatch({ type: "select", nodeId: id, origin: "tree" }),
  });

  if (warnings.length === 0) {
    return <div className="treepanel-empty">No warnings.</div>;
  }
  return (
    <ul
      className="treepanel-list"
      role="listbox"
      aria-label="Warnings"
      aria-activedescendant={state.selectedNodeId}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {warnings.map((w) => (
        <WarningRow
          key={w.id}
          warning={w}
          selected={state.selectedNodeId === w.id}
          onSelect={() => dispatch({ type: "select", nodeId: w.id, origin: "tree" })}
        />
      ))}
    </ul>
  );
};

type WarningRowProps = {
  warning: PdfWarning;
  selected: boolean;
  onSelect: () => void;
};

const WarningRow: FC<WarningRowProps> = ({ warning, selected, onSelect }) => {
  const tone =
    warning.severity === "error" ? "danger" : warning.severity === "warn" ? "warning" : "info";
  return (
    <li
      id={warning.id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-selected={selected}
      className="treepanel-row"
      data-tone={tone}
      onClick={onSelect}
    >
      <span className="treepanel-row-id">{warning.severity.toUpperCase()}</span>
      <span className="treepanel-chip" data-kind="other">
        {warning.category}
      </span>
      <span className="treepanel-row-hint">{warning.message}</span>
    </li>
  );
};
