import { useState } from "react";
import type { ObjectId, PdfValue } from "../../../shared/ir-types";

interface PdfValueViewProps {
  value: PdfValue;
  onRefClick?: (objectId: ObjectId) => void;
}

export function PdfValueView({ value, onRefClick }: PdfValueViewProps): JSX.Element {
  return (
    <div className="pdfvalue">
      <Value value={value} onRefClick={onRefClick} depth={0} />
    </div>
  );
}

function Value({
  value,
  onRefClick,
  depth,
}: {
  value: PdfValue;
  onRefClick?: (id: ObjectId) => void;
  depth: number;
}): JSX.Element {
  switch (value.kind) {
    case "null":
      return <span className="pdfvalue-null">null</span>;
    case "bool":
      return <span className="pdfvalue-bool">{String(value.value)}</span>;
    case "int":
    case "real":
      return <span className="pdfvalue-num">{value.value}</span>;
    case "name":
      return <span className="pdfvalue-name">{`/${value.value}`}</span>;
    case "string":
      return <StringView value={value} />;
    case "array":
      return (
        <Collection
          open="["
          close="]"
          items={value.items.map((item, i) => ({ key: i.toString(), value: item }))}
          onRefClick={onRefClick}
          depth={depth}
        />
      );
    case "dict":
      return (
        <Collection
          open="<<"
          close=">>"
          items={Object.entries(value.entries).map(([k, v]) => ({ key: k, label: `/${k}`, value: v }))}
          onRefClick={onRefClick}
          depth={depth}
        />
      );
    case "ref":
      return (
        <button
          type="button"
          className="pdfvalue-ref"
          onClick={() => onRefClick?.(value.target)}
          title={`Jump to ${value.target}`}
        >
          {parseNumGen(value.target)}
        </button>
      );
    case "stream":
      return (
        <div className="pdfvalue-stream">
          <span className="pdfvalue-name">stream</span>{" "}
          <span className="pdfvalue-comment">
            {`(filters: ${value.handle.filters
              .map((f) => (typeof f === "string" ? f : f.name))
              .join(", ") || "none"}; length: ${value.handle.length})`}
          </span>
          <Collection
            open="<<"
            close=">>"
            items={Object.entries(value.dict).map(([k, v]) => ({ key: k, label: `/${k}`, value: v }))}
            onRefClick={onRefClick}
            depth={depth}
          />
        </div>
      );
    default: {
      // exhaustive
      const _x: never = value;
      return <span>{String(_x)}</span>;
    }
  }
}

function Collection({
  open,
  close,
  items,
  onRefClick,
  depth,
}: {
  open: string;
  close: string;
  items: { key: string; label?: string; value: PdfValue }[];
  onRefClick?: (id: ObjectId) => void;
  depth: number;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(depth > 1);
  if (items.length === 0) {
    return <span className="pdfvalue-empty">{open} {close}</span>;
  }
  return (
    <span className="pdfvalue-collection">
      <button
        type="button"
        className="pdfvalue-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        {collapsed ? "▸" : "▾"} {open}
        {collapsed && (
          <span className="pdfvalue-comment"> {items.length} {open === "[" ? "items" : "entries"} </span>
        )}
        {collapsed && close}
      </button>
      {!collapsed && (
        <ul className="pdfvalue-list">
          {items.map((item) => (
            <li key={item.key} className="pdfvalue-entry">
              {item.label && <span className="pdfvalue-name">{item.label}</span>}
              {item.label && " "}
              <Value value={item.value} onRefClick={onRefClick} depth={depth + 1} />
            </li>
          ))}
        </ul>
      )}
      {!collapsed && <span className="pdfvalue-close">{close}</span>}
    </span>
  );
}

function StringView({ value }: { value: { kind: "string"; raw: Uint8Array; hex?: boolean } }): JSX.Element {
  const text = tryDecode(value.raw);
  if (text != null) {
    return <span className="pdfvalue-string">{`(${escape(text)})`}</span>;
  }
  return (
    <span className="pdfvalue-string-hex">
      &lt;{Array.from(value.raw)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 64)}
      {value.raw.length > 32 ? "…" : ""}&gt;
    </span>
  );
}

function tryDecode(raw: Uint8Array): string | null {
  let s = "";
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i] ?? 0;
    if (b < 0x20 || b > 0x7e) return null;
    s += String.fromCharCode(b);
  }
  return s;
}

function escape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function parseNumGen(id: string): string {
  const m = /^obj:(\d+):(\d+)$/.exec(id);
  if (!m) return id;
  return `${m[1]} ${m[2]} R`;
}
