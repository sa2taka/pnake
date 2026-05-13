import { useApp } from "../../state/AppContext";
import type { FC } from "react";
import type { ObjectId, PdfStructTreeChild, PdfStructTreeNode } from "../../../shared/ir-types";

export const StructureView: FC = () => {
  const { state, dispatch } = useApp();
  const structTree = state.document.status === "loaded" ? state.document.structTree : undefined;
  if (!structTree) {
    return (
      <div className="treepanel-empty">
        This PDF has no logical structure (it is not a tagged PDF).
      </div>
    );
  }
  return (
    <ul className="treepanel-list" role="listbox" aria-label="PDF logical structure">
      <StructNode
        node={structTree.root}
        depth={0}
        onSelect={(target) => dispatch({ type: "select", nodeId: target, origin: "tree" })}
      />
    </ul>
  );
};

type StructNodeProps = {
  node: PdfStructTreeNode;
  depth: number;
  onSelect: (id: string) => void;
};

const StructNode: FC<StructNodeProps> = ({ node, depth, onSelect }) => (
  <>
    <li
      className="treepanel-row"
      data-testid={`struct-${node.id}`}
      onClick={() => node.objectRef && onSelect(node.objectRef)}
    >
      <span className="treepanel-row-id" style={{ paddingLeft: depth * 12 }}>
        {node.structureType}
      </span>
      {node.title && <span className="treepanel-row-hint">{node.title}</span>}
      {node.alt && (
        <span className="treepanel-chip" data-kind="metadata">
          alt
        </span>
      )}
    </li>
    {node.children.map((child, i) => (
      <StructChildRow key={i} child={child} depth={depth + 1} onSelect={onSelect} />
    ))}
  </>
);

type StructChildRowProps = {
  child: PdfStructTreeChild;
  depth: number;
  onSelect: (id: string) => void;
};

const StructChildRow: FC<StructChildRowProps> = ({ child, depth, onSelect }) => {
  if (child.kind === "elem") {
    return <StructNode node={child.node} depth={depth} onSelect={onSelect} />;
  }
  if (child.kind === "mcid") {
    return <McidRow mcid={child.mcid} page={child.page} depth={depth} onSelect={onSelect} />;
  }
  // objr
  return (
    <li
      className="treepanel-row"
      data-testid={`struct-objr-${child.ref}`}
      onClick={() => onSelect(child.ref)}
    >
      <span className="treepanel-row-id" style={{ paddingLeft: depth * 12 }}>
        OBJ {child.ref}
      </span>
    </li>
  );
};

type McidRowProps = {
  mcid: number;
  page: ObjectId | undefined;
  depth: number;
  onSelect: (id: string) => void;
};

const McidRow: FC<McidRowProps> = ({ mcid, page, depth, onSelect }) => {
  const { state, dispatch } = useApp();
  // Try to resolve the MCID to a concrete operation on the current page.
  const opOnCurrentPage =
    state.pageOps.status === "loaded"
      ? state.pageOps.result.operations.find((o) => o.mcid === mcid)
      : undefined;
  const analysis = state.document.status === "loaded" ? state.document.analysis : undefined;
  return (
    <li
      className="treepanel-row"
      data-testid={`struct-mcid-${mcid}`}
      onClick={() => {
        // If a different page is requested, switch to it; the click handler
        // then re-resolves the MCID on that page.
        if (page && analysis) {
          const idx = analysis.pages.findIndex((p) => p.objectRef === page);
          if (idx >= 0 && idx + 1 !== state.currentPage) {
            dispatch({ type: "setCurrentPage", pageNumber: idx + 1 });
            return;
          }
        }
        if (opOnCurrentPage) onSelect(opOnCurrentPage.id);
      }}
    >
      <span className="treepanel-row-id" style={{ paddingLeft: depth * 12 }}>
        MCID {mcid}
      </span>
      {page && <span className="treepanel-row-hint">page = {page}</span>}
      {opOnCurrentPage && (
        <span className="treepanel-chip" data-kind={opOnCurrentPage.category}>
          {opOnCurrentPage.operator}
        </span>
      )}
    </li>
  );
};
