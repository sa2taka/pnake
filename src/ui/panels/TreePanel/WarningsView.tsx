import { useApp } from "../../state/AppContext";
import type { FC } from "react";
import type { PdfWarning } from "../../../shared/ir-types";

export const WarningsView: FC = () => {
  const { state } = useApp();
  const warnings = state.document.status === "loaded" ? state.document.analysis.warnings : [];
  if (warnings.length === 0) {
    return <div className="treepanel-empty">No warnings.</div>;
  }
  return (
    <ul className="treepanel-list" role="listbox" aria-label="Warnings">
      {warnings.map((w) => (
        <WarningRow key={w.id} warning={w} />
      ))}
    </ul>
  );
};

type WarningRowProps = { warning: PdfWarning };

const WarningRow: FC<WarningRowProps> = ({ warning }) => {
  const tone =
    warning.severity === "error" ? "danger" : warning.severity === "warn" ? "warning" : "info";
  return (
    <li className="treepanel-row" data-tone={tone}>
      <span className="treepanel-row-id">{warning.severity.toUpperCase()}</span>
      <span className="treepanel-chip" data-kind="other">
        {warning.category}
      </span>
      <span className="treepanel-row-hint">{warning.message}</span>
    </li>
  );
};
