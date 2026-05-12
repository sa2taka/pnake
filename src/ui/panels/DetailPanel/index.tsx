import { useEffect, useState } from "react";
import { PanelHeader } from "../PanelHeader";
import { useApp } from "../../state/AppContext";
import type { PdfObjectDetail, PdfOperation } from "../../../shared/ir-types";
import { PdfValueView } from "./PdfValueView";
import "./DetailPanel.css";

type Tab = "human" | "technical" | "raw";

export function DetailPanel(): JSX.Element {
  const { state, parser, dispatch } = useApp();
  const [detail, setDetail] = useState<PdfObjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("technical");

  // Look up the selected operation when applicable.
  const operation: PdfOperation | undefined = (() => {
    if (!state.selectedNodeId?.startsWith("page:")) return undefined;
    return state.pageOperations?.operations.find(
      (op) => op.id === state.selectedNodeId,
    );
  })();

  useEffect(() => {
    setError(null);
    if (!state.selectedNodeId || !state.analysis) {
      setDetail(null);
      return;
    }
    if (!state.selectedNodeId.startsWith("obj:")) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    parser
      .getObjectDetail(state.selectedNodeId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [state.selectedNodeId, state.analysis, parser]);

  return (
    <div className="detailpanel" data-testid="detail-panel">
      <PanelHeader
        title="Detail"
        subtitle={detail?.id ?? operation?.id}
        actions={
          detail || operation ? (
            <div className="detailpanel-tabs" role="tablist">
              {(["human", "technical", "raw"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className="detailpanel-tab"
                  onClick={() => setTab(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          ) : null
        }
      />
      <div className="detailpanel-body">
        {!state.selectedNodeId && (
          <p className="detailpanel-empty">Select a node to see its details.</p>
        )}
        {error && (
          <p className="detailpanel-error" role="alert">
            {error}
          </p>
        )}
        {detail && tab === "human" && <HumanView detail={detail} />}
        {detail && tab === "technical" && <TechnicalView detail={detail} dispatch={dispatch} />}
        {detail && tab === "raw" && <RawView detail={detail} />}
        {operation && (
          <OperationView operation={operation} tab={tab} />
        )}
      </div>
    </div>
  );
}

function HumanView({ detail }: { detail: PdfObjectDetail }): JSX.Element {
  return (
    <div className="detailpanel-human">
      <p>
        Object <code>{detail.id}</code> is a <strong>{detail.type}</strong>
        {detail.hint && (
          <>
            {" "}
            (<code>{detail.hint}</code>)
          </>
        )}
        .
      </p>
      {detail.hasStream && (
        <p>
          This object carries a stream. Switch to the bottom drawer to inspect raw or decoded
          bytes.
        </p>
      )}
    </div>
  );
}

function TechnicalView({
  detail,
  dispatch,
}: {
  detail: PdfObjectDetail;
  dispatch: ReturnType<typeof useApp>["dispatch"];
}): JSX.Element {
  return (
    <div className="detailpanel-technical">
      <dl className="detailpanel-meta">
        <dt>ID</dt>
        <dd>{detail.id}</dd>
        <dt>Type</dt>
        <dd>{detail.type}</dd>
        <dt>Byte range</dt>
        <dd>
          {detail.byteRange.start}–{detail.byteRange.end}
        </dd>
        {detail.hint && (
          <>
            <dt>Hint</dt>
            <dd>{detail.hint}</dd>
          </>
        )}
        <dt>Has stream</dt>
        <dd>{detail.hasStream ? "yes" : "no"}</dd>
      </dl>
      <h3 className="detailpanel-section-title">Value</h3>
      <PdfValueView
        value={detail.value}
        onRefClick={(id) =>
          dispatch({ type: "select", nodeId: id, origin: "detail" })
        }
      />
    </div>
  );
}

function RawView({ detail }: { detail: PdfObjectDetail }): JSX.Element {
  return (
    <pre className="detailpanel-raw">{detail.rawText}</pre>
  );
}

function OperationView({
  operation,
  tab,
}: {
  operation: PdfOperation;
  tab: Tab;
}): JSX.Element {
  return (
    <div className="detailpanel-technical">
      <dl className="detailpanel-meta">
        <dt>Operator</dt>
        <dd>
          <code>{operation.operator}</code>
        </dd>
        <dt>Category</dt>
        <dd>{operation.category}</dd>
        <dt>Sequence</dt>
        <dd>{operation.sequence}</dd>
        {operation.decodedRange && (
          <>
            <dt>Decoded range</dt>
            <dd>
              {operation.decodedRange.start}–{operation.decodedRange.end}
            </dd>
          </>
        )}
      </dl>
      <h3 className="detailpanel-section-title">Operands</h3>
      <ul className="detailpanel-operands">
        {operation.operands.length === 0 && (
          <li className="detailpanel-empty">(no operands)</li>
        )}
        {operation.operands.map((operand, i) => (
          <li key={i}>
            <PdfValueView value={operand} />
          </li>
        ))}
      </ul>
      {tab === "human" && (
        <p className="detailpanel-empty">
          Human-readable explanations are added in a follow-up commit.
        </p>
      )}
    </div>
  );
}
