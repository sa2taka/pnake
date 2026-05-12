import { useEffect, useState } from "react";
import { useApp } from "../../state/AppContext";
import type { PageOperationsResult } from "../../../shared/protocol";

export function ContentView(): JSX.Element {
  const { state, parser, dispatch } = useApp();
  const [result, setResult] = useState<PageOperationsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setResult(null);
    if (state.status !== "loaded") return;
    let cancelled = false;
    parser
      .getPageOperations(state.currentPage)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [state.currentPage, state.status, parser]);

  if (error) return <div className="treepanel-empty">Error: {error}</div>;
  if (!result) return <div className="treepanel-empty">Parsing page content…</div>;
  if (result.operations.length === 0)
    return <div className="treepanel-empty">No content operators on this page.</div>;

  // Compute q/Q + BT/ET indent levels for a compact timeline.
  let depth = 0;
  const rows = result.operations.map((op) => {
    if (op.operator === "Q" || op.operator === "ET" || op.operator === "EMC") depth = Math.max(0, depth - 1);
    const row = { op, depth };
    if (op.operator === "q" || op.operator === "BT" || op.operator === "BMC" || op.operator === "BDC") depth++;
    return row;
  });

  return (
    <ul
      className="treepanel-list"
      role="tree"
      aria-label={`Content of page ${state.currentPage}`}
    >
      {rows.map(({ op, depth: rowDepth }) => (
        <li
          key={op.id}
          className="treepanel-row"
          data-testid={`tree-op-${op.sequence}`}
          data-selected={state.selectedNodeId === op.id}
          onClick={() =>
            dispatch({ type: "select", nodeId: op.id, origin: "tree" })
          }
        >
          <span className="treepanel-row-id" style={{ paddingLeft: rowDepth * 12 }}>
            {op.sequence}
          </span>
          <span className="treepanel-chip" data-kind={op.category}>
            {op.operator}
          </span>
          <span className="treepanel-row-hint">{formatOperands(op.operands)}</span>
        </li>
      ))}
    </ul>
  );
}

function formatOperands(operands: PageOperationsResult["operations"][number]["operands"]): string {
  if (operands.length === 0) return "";
  return operands
    .slice(0, 4)
    .map(formatOperand)
    .concat(operands.length > 4 ? ["…"] : [])
    .join(" ");
}

function formatOperand(v: { kind: string; value?: unknown }): string {
  switch (v.kind) {
    case "int":
    case "real":
      return String(v.value);
    case "name":
      return `/${String(v.value)}`;
    case "string":
      return "(…)";
    case "array":
      return "[…]";
    case "dict":
      return "<<…>>";
    case "ref":
      return String(v.value);
    case "bool":
      return String(v.value);
    case "null":
      return "null";
    default:
      return "?";
  }
}
