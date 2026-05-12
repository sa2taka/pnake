import { useEffect, useState } from "react";
import { PanelHeader } from "../PanelHeader";
import { useApp, type BottomTab } from "../../state/AppContext";
import { isObjectId } from "../../../shared/ir-types";
import "./BottomDrawer.css";

const TABS: { id: BottomTab; label: string }[] = [
  { id: "raw", label: "Raw" },
  { id: "decoded", label: "Decoded" },
  { id: "trace", label: "Trace" },
  { id: "graphics-state", label: "Graphics" },
];

const MAX_PREVIEW_BYTES = 4096;

export function BottomDrawer(): JSX.Element {
  const { state, parser, dispatch } = useApp();
  const tab = state.bottomTab;

  return (
    <div className="bottomdrawer" data-testid="bottom-drawer">
      <PanelHeader
        title="Drawer"
        actions={
          <div className="bottomdrawer-tabs" role="group" aria-label="Drawer view">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                className="bottomdrawer-tab"
                onClick={() => dispatch({ type: "setBottomTab", tab: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="bottomdrawer-body">
        {tab === "raw" || tab === "decoded" ? (
          <StreamPreview tab={tab} parser={parser} selectedId={state.selectedNodeId} />
        ) : (
          <p className="bottomdrawer-empty">Available after Phase 2/3.</p>
        )}
      </div>
    </div>
  );
}

function StreamPreview({
  tab,
  parser,
  selectedId,
}: {
  tab: "raw" | "decoded";
  parser: ReturnType<typeof useApp>["parser"];
  selectedId: string | undefined;
}): JSX.Element {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setBytes(null);
    setError(null);
    if (!selectedId || !isObjectId(selectedId)) return;
    let cancelled = false;
    setLoading(true);
    parser
      .getStream(selectedId, tab)
      .then((result) => {
        if (cancelled) return;
        setBytes(new Uint8Array(result.bytes));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, tab, parser]);

  if (!selectedId) return <p className="bottomdrawer-empty">Select an object first.</p>;
  if (loading) return <p className="bottomdrawer-empty">loading…</p>;
  if (error)
    return (
      <p className="bottomdrawer-empty bottomdrawer-error" role="alert">
        {error}
      </p>
    );
  if (!bytes) return <p className="bottomdrawer-empty">No stream data.</p>;
  return <HexView bytes={bytes} />;
}

function HexView({ bytes }: { bytes: Uint8Array }): JSX.Element {
  const visible = bytes.subarray(0, MAX_PREVIEW_BYTES);
  const lines: { offset: number; hex: string; ascii: string }[] = [];
  for (let i = 0; i < visible.length; i += 16) {
    const row = visible.subarray(i, i + 16);
    let hex = "";
    let ascii = "";
    for (let j = 0; j < row.length; j++) {
      const b = row[j] ?? 0;
      hex += b.toString(16).padStart(2, "0") + (j === 7 ? "  " : " ");
      ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
    }
    lines.push({ offset: i, hex, ascii });
  }
  // <pre> may only contain phrasing content per the HTML spec — div is
  // flow content, so we use plain divs and apply monospace styling via
  // the container class instead.
  return (
    <div className="bottomdrawer-hex">
      {lines.map((l) => (
        <div key={l.offset} className="bottomdrawer-hex-row">
          <span className="bottomdrawer-hex-offset">
            {l.offset.toString(16).padStart(8, "0")}
          </span>
          <span className="bottomdrawer-hex-bytes">{l.hex}</span>
          <span className="bottomdrawer-hex-ascii">{l.ascii}</span>
        </div>
      ))}
      {bytes.length > MAX_PREVIEW_BYTES && (
        <div className="bottomdrawer-hex-row bottomdrawer-hex-truncated">
          … {bytes.length - MAX_PREVIEW_BYTES} more bytes
        </div>
      )}
    </div>
  );
}
