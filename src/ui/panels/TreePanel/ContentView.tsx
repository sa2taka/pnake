import { useEffect, useMemo, useRef } from "react";
import { useApp } from "../../state/AppContext";
import type { PdfOperation, PdfValue } from "../../../shared/ir-types";

export function ContentView(): JSX.Element {
  const { state, dispatch } = useApp();
  const operations = state.pageOperations?.operations ?? [];
  const selectedRef = useRef<HTMLLIElement | null>(null);

  // Scroll the selected row into view when selection moves to this page.
  useEffect(() => {
    if (state.selectionOrigin === "tree") return;
    selectedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.selectedNodeId, state.selectionOrigin]);

  // Compute q/Q + BT/ET indent levels for a compact timeline.
  const rows = useMemo(() => {
    let depth = 0;
    return operations.map((op) => {
      if (op.operator === "Q" || op.operator === "ET" || op.operator === "EMC") depth = Math.max(0, depth - 1);
      const row = { op, depth };
      if (op.operator === "q" || op.operator === "BT" || op.operator === "BMC" || op.operator === "BDC") depth++;
      return row;
    });
  }, [operations]);

  if (state.pageOperationsStatus === "loading")
    return <div className="treepanel-empty">Parsing page content…</div>;
  if (state.pageOperationsStatus === "error")
    return (
      <div className="treepanel-empty">
        Error: {state.pageOperationsError}
      </div>
    );
  if (operations.length === 0)
    return <div className="treepanel-empty">No content operators on this page.</div>;

  return (
    <ul
      className="treepanel-list"
      role="listbox"
      aria-label={`Content of page ${state.currentPage}`}
    >
      {rows.map(({ op, depth: rowDepth }) => {
        const selected = state.selectedNodeId === op.id;
        return (
          <li
            ref={selected ? selectedRef : null}
            key={op.id}
            className="treepanel-row"
            data-testid={`tree-op-${op.sequence}`}
            data-selected={selected}
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
        );
      })}
    </ul>
  );
}

function formatOperands(operands: PdfOperation["operands"]): string {
  if (operands.length === 0) return "";
  return operands
    .slice(0, 4)
    .map(formatOperand)
    .concat(operands.length > 4 ? ["…"] : [])
    .join(" ");
}

function formatOperand(v: PdfValue): string {
  switch (v.kind) {
    case "int":
    case "real":
      return String(v.value);
    case "name":
      return `/${v.value}`;
    case "string":
      return "(…)";
    case "array":
      return "[…]";
    case "dict":
      return "<<…>>";
    case "ref":
      return v.target;
    case "bool":
      return String(v.value);
    case "null":
      return "null";
    case "stream":
      return "stream";
    default: {
      const _x: never = v;
      void _x;
      return "?";
    }
  }
}
