import { useCallback, useMemo, useState, type FC, type KeyboardEvent } from "react";
import { useApp } from "../../state/AppContext";
import { useVirtualList } from "../../hooks/useVirtualList";
import type { PdfObjectKind, PdfObjectSummary } from "../../../shared/ir-types";

const ROW_HEIGHT = 24;

export const ObjectsView: FC = () => {
  const { state, dispatch } = useApp();
  const [filter, setFilter] = useState("");

  const analysis = state.document.status === "loaded" ? state.document.analysis : undefined;

  const objects = useMemo(() => {
    if (!analysis) return [];
    const list = Object.values(analysis.objectsIndex);
    list.sort((a, b) => a.number - b.number || a.generation - b.generation);
    if (!filter) return list;
    const q = filter.toLowerCase();
    return list.filter(
      (o) =>
        o.id.includes(q) ||
        o.type.includes(q) ||
        (o.hint?.toLowerCase().includes(q) ?? false) ||
        o.number.toString().includes(q),
    );
  }, [analysis, filter]);

  const { containerRef, range, totalHeight } = useVirtualList<HTMLDivElement>(
    objects.length,
    ROW_HEIGHT,
  );

  const visible = objects.slice(range.start, range.end);

  // Keyboard nav is inlined here (instead of useListboxNav) because the
  // virtual list needs scrollTop to be set explicitly — id-based
  // scrollIntoView doesn't work for rows that aren't rendered yet.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (objects.length === 0) return;
      const currentIndex = state.selectedNodeId
        ? objects.findIndex((o) => o.id === state.selectedNodeId)
        : -1;
      let nextIndex: number;
      switch (event.key) {
        case "ArrowDown":
          nextIndex = currentIndex < 0 ? 0 : Math.min(objects.length - 1, currentIndex + 1);
          break;
        case "ArrowUp":
          nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = objects.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      const next = objects[nextIndex];
      if (!next) return;
      if (next.id !== state.selectedNodeId) {
        dispatch({ type: "select", nodeId: next.id, origin: "tree" });
      }
      // Bring the row into view by sliding scrollTop just enough.
      const container = containerRef.current;
      if (!container) return;
      const rowTop = nextIndex * ROW_HEIGHT;
      const rowBottom = rowTop + ROW_HEIGHT;
      if (rowTop < container.scrollTop) {
        container.scrollTop = rowTop;
      } else if (rowBottom > container.scrollTop + container.clientHeight) {
        container.scrollTop = rowBottom - container.clientHeight;
      }
    },
    [objects, state.selectedNodeId, dispatch, containerRef],
  );

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
      <div
        ref={containerRef}
        className="treepanel-virtual"
        data-testid="objects-virtual"
        role="listbox"
        aria-label="PDF objects"
        aria-activedescendant={state.selectedNodeId}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div className="treepanel-virtual-inner" style={{ height: totalHeight }}>
          {visible.map((obj, i) => (
            <div
              key={obj.id}
              className="treepanel-virtual-row"
              style={{ top: (range.start + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <ObjectRow
                obj={obj}
                selected={obj.id === state.selectedNodeId}
                onSelect={() => dispatch({ type: "select", nodeId: obj.id, origin: "tree" })}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

type ObjectRowProps = {
  obj: PdfObjectSummary;
  selected: boolean;
  onSelect: () => void;
};

const ObjectRow: FC<ObjectRowProps> = ({ obj, selected, onSelect }) => (
  <div
    id={obj.id}
    role="option"
    aria-selected={selected}
    data-selected={selected}
    data-testid={`tree-row-${obj.id}`}
    className="treepanel-row"
    // The listbox container owns keyboard focus; options stay
    // programmatically focusable so screen readers can target them
    // via aria-activedescendant.
    tabIndex={-1}
    onClick={onSelect}
  >
    <span className="treepanel-row-id">{`${obj.number} ${obj.generation}`}</span>
    <KindChip kind={obj.type} stream={obj.hasStream} />
    {obj.hint && <span className="treepanel-row-hint">{obj.hint}</span>}
  </div>
);

type KindChipProps = { kind: PdfObjectKind; stream: boolean };

const KindChip: FC<KindChipProps> = ({ kind, stream }) => (
  <span className="treepanel-chip" data-kind={kind}>
    {chipLabel(kind)}
    {stream ? "·S" : ""}
  </span>
);

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
