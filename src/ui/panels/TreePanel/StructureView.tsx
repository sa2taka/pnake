import { useMemo, type FC } from "react";
import { useApp } from "../../state/AppContext";
import { useListboxNav } from "../../hooks/useListboxNav";
import type { ObjectId, PdfStructTreeChild, PdfStructTreeNode } from "../../../shared/ir-types";

/**
 * Pre-walk the tree once and produce both the flat row list (for
 * keyboard navigation) and a stable map from row id to its activation
 * handler. Keeps StructureView's render simple — every row just calls
 * the right handler from the map on click.
 */
type FlatRow =
  | { kind: "elem"; rowId: string; node: PdfStructTreeNode; depth: number }
  | { kind: "mcid"; rowId: string; mcid: number; page: ObjectId | undefined; depth: number }
  | { kind: "objr"; rowId: string; ref: ObjectId; depth: number };

function flatten(root: PdfStructTreeNode): FlatRow[] {
  const out: FlatRow[] = [];
  let mcidCounter = 0;
  function visit(node: PdfStructTreeNode, depth: number): void {
    out.push({ kind: "elem", rowId: node.id, node, depth });
    for (const child of node.children) {
      visitChild(child, depth + 1);
    }
  }
  function visitChild(child: PdfStructTreeChild, depth: number): void {
    if (child.kind === "elem") {
      visit(child.node, depth);
      return;
    }
    if (child.kind === "mcid") {
      // MCID rows aren't unique by mcid alone (a page can have many);
      // suffix with a running counter so DOM ids stay distinct.
      const rowId = `struct-mcid:${mcidCounter++}:${child.mcid}`;
      out.push({ kind: "mcid", rowId, mcid: child.mcid, page: child.page, depth });
      return;
    }
    out.push({ kind: "objr", rowId: `struct-objr:${child.ref}`, ref: child.ref, depth });
  }
  visit(root, 0);
  return out;
}

export const StructureView: FC = () => {
  const { state, dispatch } = useApp();
  const structTree = state.document.status === "loaded" ? state.document.structTree : undefined;
  const analysis = state.document.status === "loaded" ? state.document.analysis : undefined;
  const rows = useMemo(() => (structTree ? flatten(structTree.root) : []), [structTree]);

  // Activating a struct row dispatches whatever that row "means". MCID
  // rows have page-switching logic; elem rows route to their objectRef
  // when present; objr rows route to the target ref.
  const activate = (row: FlatRow): void => {
    if (row.kind === "elem") {
      if (row.node.objectRef) {
        dispatch({ type: "select", nodeId: row.node.objectRef, origin: "tree" });
      }
      return;
    }
    if (row.kind === "objr") {
      dispatch({ type: "select", nodeId: row.ref, origin: "tree" });
      return;
    }
    // mcid
    if (state.pageOps.status === "loaded") {
      const op = state.pageOps.result.operations.find((o) => o.mcid === row.mcid);
      if (op) {
        dispatch({ type: "select", nodeId: op.id, origin: "tree" });
        return;
      }
    }
    // Different page: switch to it; the next render's MCID lookup will resolve.
    if (row.page && analysis) {
      const idx = analysis.pages.findIndex((p) => p.objectRef === row.page);
      if (idx >= 0 && idx + 1 !== state.currentPage) {
        dispatch({ type: "setCurrentPage", pageNumber: idx + 1 });
      }
    }
  };

  const onKeyDown = useListboxNav({
    ids: rows.map((r) => r.rowId),
    selectedId: state.selectedNodeId,
    onSelect: (id) => {
      const row = rows.find((r) => r.rowId === id);
      if (row) activate(row);
    },
  });

  if (!structTree) {
    return (
      <div className="treepanel-empty">
        This PDF has no logical structure (it is not a tagged PDF).
      </div>
    );
  }

  return (
    <ul
      className="treepanel-list"
      role="listbox"
      aria-label="PDF logical structure"
      aria-activedescendant={state.selectedNodeId}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {rows.map((row) => (
        <StructRow
          key={row.rowId}
          row={row}
          selected={state.selectedNodeId === row.rowId}
          onActivate={() => activate(row)}
        />
      ))}
    </ul>
  );
};

type StructRowProps = {
  row: FlatRow;
  selected: boolean;
  onActivate: () => void;
};

const StructRow: FC<StructRowProps> = ({ row, selected, onActivate }) => {
  const liProps = {
    id: row.rowId,
    role: "option" as const,
    "aria-selected": selected,
    tabIndex: -1,
    "data-selected": selected,
    className: "treepanel-row",
    onClick: onActivate,
  };

  if (row.kind === "elem") {
    const node = row.node;
    return (
      <li {...liProps} data-testid={`struct-${node.id}`}>
        <span className="treepanel-row-id" style={{ paddingLeft: row.depth * 12 }}>
          {node.structureType}
        </span>
        {node.title && <span className="treepanel-row-hint">{node.title}</span>}
        {node.alt && (
          <span className="treepanel-chip" data-kind="metadata">
            alt
          </span>
        )}
      </li>
    );
  }

  if (row.kind === "objr") {
    return (
      <li {...liProps} data-testid={`struct-objr-${row.ref}`}>
        <span className="treepanel-row-id" style={{ paddingLeft: row.depth * 12 }}>
          OBJ {row.ref}
        </span>
      </li>
    );
  }

  // mcid
  return (
    <li {...liProps} data-testid={`struct-mcid-${row.mcid}`}>
      <span className="treepanel-row-id" style={{ paddingLeft: row.depth * 12 }}>
        MCID {row.mcid}
      </span>
      {row.page && <span className="treepanel-row-hint">page = {row.page}</span>}
    </li>
  );
};
