import { useApp } from "../../state/AppContext";
import type {
  PdfStructTreeChild,
  PdfStructTreeNode,
} from "../../../shared/ir-types";

export function StructureView(): JSX.Element {
  const { state, dispatch } = useApp();
  if (!state.structTree) {
    return (
      <div className="treepanel-empty">
        This PDF has no logical structure (it is not a tagged PDF).
      </div>
    );
  }
  return (
    <ul
      className="treepanel-list"
      role="tree"
      aria-label="PDF logical structure"
    >
      <StructNode
        node={state.structTree.root}
        depth={0}
        onSelect={(target) =>
          dispatch({ type: "select", nodeId: target, origin: "tree" })
        }
      />
    </ul>
  );
}

function StructNode({
  node,
  depth,
  onSelect,
}: {
  node: PdfStructTreeNode;
  depth: number;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <>
      <li
        className="treepanel-row"
        data-testid={`struct-${node.id}`}
        onClick={() => node.objectRef && onSelect(node.objectRef)}
      >
        <span className="treepanel-row-id" style={{ paddingLeft: depth * 12 }}>
          {node.structureType}
        </span>
        {node.title && (
          <span className="treepanel-row-hint">{node.title}</span>
        )}
        {node.alt && (
          <span className="treepanel-chip" data-kind="metadata">
            alt
          </span>
        )}
      </li>
      {node.children.map((child, i) => (
        <StructChildRow
          key={i}
          child={child}
          depth={depth + 1}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function StructChildRow({
  child,
  depth,
  onSelect,
}: {
  child: PdfStructTreeChild;
  depth: number;
  onSelect: (id: string) => void;
}): JSX.Element {
  if (child.kind === "elem") {
    return <StructNode node={child.node} depth={depth} onSelect={onSelect} />;
  }
  if (child.kind === "mcid") {
    return (
      <li className="treepanel-row" data-testid={`struct-mcid-${child.mcid}`}>
        <span className="treepanel-row-id" style={{ paddingLeft: depth * 12 }}>
          MCID {child.mcid}
        </span>
        {child.page && (
          <span className="treepanel-row-hint">page = {child.page}</span>
        )}
      </li>
    );
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
}
