import { useMemo, useState } from "react";
import { useApp } from "../../state/AppContext";
import type { PdfObjectKind, PdfObjectSummary } from "../../../shared/ir-types";

export function ObjectsView(): JSX.Element {
  const { state, dispatch } = useApp();
  const [filter, setFilter] = useState("");

  const objects = useMemo(() => {
    if (!state.analysis) return [];
    const list = Object.values(state.analysis.objectsIndex);
    list.sort((a, b) => a.number - b.number || a.generation - b.generation);
    if (!filter) return list;
    const q = filter.toLowerCase();
    return list.filter(
      (o) =>
        o.id.includes(q) ||
        o.type.includes(q) ||
        o.hint?.toLowerCase().includes(q) ||
        o.number.toString().includes(q),
    );
  }, [state.analysis, filter]);

  return (
    <div className="treepanel-body">
      <div className="treepanel-filter">
        <input
          type="search"
          placeholder="Filter by id, type, hint…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
          aria-label="Filter objects"
        />
      </div>
      <ul className="treepanel-list" role="tree" aria-label="PDF objects">
        {objects.map((obj) => (
          <ObjectRow
            key={obj.id}
            obj={obj}
            selected={obj.id === state.selectedNodeId}
            onSelect={() =>
              dispatch({ type: "select", nodeId: obj.id, origin: "tree" })
            }
          />
        ))}
      </ul>
    </div>
  );
}

interface ObjectRowProps {
  obj: PdfObjectSummary;
  selected: boolean;
  onSelect: () => void;
}

function ObjectRow({ obj, selected, onSelect }: ObjectRowProps): JSX.Element {
  return (
    <li
      role="treeitem"
      aria-selected={selected}
      data-selected={selected}
      data-testid={`tree-row-${obj.id}`}
      className="treepanel-row"
      onClick={onSelect}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="treepanel-row-id">{`${obj.number} ${obj.generation}`}</span>
      <KindChip kind={obj.type} stream={obj.hasStream} />
      {obj.hint && <span className="treepanel-row-hint">{obj.hint}</span>}
    </li>
  );
}

function KindChip({ kind, stream }: { kind: PdfObjectKind; stream: boolean }): JSX.Element {
  return (
    <span className="treepanel-chip" data-kind={kind}>
      {chipLabel(kind)}
      {stream ? "·S" : ""}
    </span>
  );
}

function chipLabel(kind: PdfObjectKind): string {
  switch (kind) {
    case "catalog":
      return "Catalog";
    case "pages":
      return "Pages";
    case "page":
      return "Page";
    case "font":
      return "Font";
    case "fontDescriptor":
      return "FontDesc";
    case "encoding":
      return "Enc";
    case "xobjectImage":
      return "Image";
    case "xobjectForm":
      return "Form";
    case "extGState":
      return "ExtGS";
    case "colorSpace":
      return "ColorSp";
    case "pattern":
      return "Pattern";
    case "shading":
      return "Shading";
    case "annot":
      return "Annot";
    case "structTreeRoot":
      return "StructTree";
    case "structElem":
      return "StructEl";
    case "metadata":
      return "Meta";
    case "embeddedFile":
      return "File";
    case "outlines":
      return "Outline";
    case "acroForm":
      return "AcroForm";
    case "signature":
      return "Sig";
    case "contentStream":
      return "ContentStm";
    case "objectStream":
      return "ObjStm";
    case "xrefStream":
      return "XRefStm";
    case "resources":
      return "Resources";
    default:
      return "Obj";
  }
}
