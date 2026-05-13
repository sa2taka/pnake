/**
 * Application state.
 *
 * One reducer keeps every cross-pane state in one place; per-pane
 * state (e.g. row hover, scroll position) stays local to that pane.
 *
 * The state shape uses nested discriminated unions so impossible
 * combinations ("status: loaded but no analysis", "pageOps: error but
 * no error message") aren't representable. Consumers narrow by
 * checking `state.document.status === "loaded"` / `state.pageOps.status
 * === "loaded"` and then read the discriminated payload directly.
 */

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type { PdfAnalysis, PdfStructTree } from "../../shared/ir-types";
import type { PageOperationsResult } from "../../shared/protocol";
import {
  createDefaultParserService,
  type ParserService,
} from "../services/parser-service";

export type TreeViewMode =
  | "file"
  | "objects"
  | "pages"
  | "resources"
  | "content"
  | "structure"
  | "warnings";

export type BottomTab = "raw" | "decoded" | "trace" | "graphics-state";

export type SelectionOrigin = "tree" | "overlay" | "trace" | "detail" | "search";

// =============================================================================
// State shape — nested discriminated unions
// =============================================================================

export type DocumentState =
  | { status: "idle" }
  | { status: "loading"; fileName?: string }
  | { status: "error"; fileName?: string; error: string }
  | {
      status: "loaded";
      fileName?: string;
      fileBytes?: ArrayBuffer;
      analysis: PdfAnalysis;
      structTree?: PdfStructTree;
    };

export type PageOpsState =
  | { status: "idle" }
  | { status: "loading"; pageNumber: number }
  | { status: "error"; pageNumber: number; error: string }
  | { status: "loaded"; result: PageOperationsResult };

export interface AppState {
  document: DocumentState;
  pageOps: PageOpsState;
  selectedNodeId?: string;
  selectionOrigin: SelectionOrigin;
  treeView: TreeViewMode;
  bottomTab: BottomTab;
  bottomOpen: boolean;
  currentPage: number;
}

type Action =
  | { type: "loadStart"; fileName?: string }
  | {
      type: "loadSuccess";
      analysis: PdfAnalysis;
      structTree?: PdfStructTree;
      fileName?: string;
      fileBytes?: ArrayBuffer;
    }
  | { type: "loadError"; error: string }
  | { type: "select"; nodeId: string | undefined; origin: SelectionOrigin }
  | { type: "setTreeView"; mode: TreeViewMode }
  | { type: "setBottomTab"; tab: BottomTab }
  | { type: "toggleBottom" }
  | { type: "setBottomOpen"; open: boolean }
  | { type: "setCurrentPage"; pageNumber: number }
  | { type: "pageOpsStart"; pageNumber: number }
  | { type: "pageOpsSuccess"; result: PageOperationsResult }
  | { type: "pageOpsError"; pageNumber: number; error: string };

export const initialState: AppState = {
  document: { status: "idle" },
  pageOps: { status: "idle" },
  selectionOrigin: "tree",
  treeView: "objects",
  bottomTab: "raw",
  bottomOpen: false,
  currentPage: 1,
};

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "loadStart":
      // Drop every load-derived slice when a new file starts loading — the
      // previous document, page ops, selection, and page must not bleed into
      // the next one.
      return {
        ...initialState,
        document: {
          status: "loading",
          ...(action.fileName ? { fileName: action.fileName } : {}),
        },
      };
    case "loadSuccess": {
      const fileName =
        action.fileName ??
        (state.document.status !== "idle" ? state.document.fileName : undefined);
      return {
        ...state,
        document: {
          status: "loaded",
          analysis: action.analysis,
          ...(action.structTree ? { structTree: action.structTree } : {}),
          ...(fileName ? { fileName } : {}),
          ...(action.fileBytes ? { fileBytes: action.fileBytes } : {}),
        },
        pageOps: { status: "idle" },
        selectedNodeId: firstSelectableId(action.analysis),
        currentPage: 1,
      };
    }
    case "loadError": {
      const fileName =
        state.document.status !== "idle" ? state.document.fileName : undefined;
      return {
        ...state,
        document: {
          status: "error",
          error: action.error,
          ...(fileName ? { fileName } : {}),
        },
        pageOps: { status: "idle" },
      };
    }
    case "select":
      return {
        ...state,
        selectedNodeId: action.nodeId,
        selectionOrigin: action.origin,
      };
    case "setTreeView":
      return { ...state, treeView: action.mode };
    case "setBottomTab":
      return { ...state, bottomTab: action.tab, bottomOpen: true };
    case "toggleBottom":
      return { ...state, bottomOpen: !state.bottomOpen };
    case "setBottomOpen":
      return { ...state, bottomOpen: action.open };
    case "setCurrentPage":
      return {
        ...state,
        currentPage: action.pageNumber,
        pageOps: { status: "idle" },
      };
    case "pageOpsStart":
      return {
        ...state,
        currentPage: action.pageNumber,
        pageOps: { status: "loading", pageNumber: action.pageNumber },
      };
    case "pageOpsSuccess":
      return {
        ...state,
        pageOps: { status: "loaded", result: action.result },
      };
    case "pageOpsError":
      return {
        ...state,
        pageOps: {
          status: "error",
          pageNumber: action.pageNumber,
          error: action.error,
        },
      };
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

function firstSelectableId(analysis: PdfAnalysis): string | undefined {
  return analysis.documentTree?.catalogRef ?? Object.keys(analysis.objectsIndex)[0];
}

// =============================================================================
// Context
// =============================================================================
//
// We split the runtime values across three separate contexts so consumers
// rerender only on the cadence they actually care about.
//
//   - StateContext: changes on every reducer dispatch (page changes,
//     selections, load progress). Consumers that read state belong here.
//   - DispatchContext: stable reference for the lifetime of the provider.
//     Components that only dispatch (Toolbar, buttons) do not need to
//     rerender on state changes.
//   - ParserContext: stable across all state changes; only flips when
//     the underlying ParserService is created / disposed.
//
// `useApp()` is preserved as a convenience hook that joins all three for
// callers that genuinely need everything. Prefer `useAppState`,
// `useAppDispatch`, `useParser` when only one slice is needed.

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  parser: ParserService;
}

const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<React.Dispatch<Action> | null>(null);
const ParserContext = createContext<ParserService | null>(null);

interface AppProviderProps {
  children: ReactNode;
  parserService?: ParserService;
}

/**
 * Owns the ParserService lifecycle.
 *
 * When the caller passes a parserService prop we treat that instance as
 * externally owned and never dispose it. When the prop is undefined we
 * create our own in a commit-phase effect (NOT in render or useMemo) and
 * dispose it on unmount or when the prop later changes. This keeps Worker
 * spawn / dispose tied to React's commit cycle so StrictMode's
 * development-time double-mount and prop changes can't leak Workers.
 */
function useParserService(externalService: ParserService | undefined): ParserService | null {
  const [internal, setInternal] = useState<ParserService | null>(null);

  useEffect(() => {
    if (externalService) {
      // Caller-supplied service: don't create / dispose anything here.
      setInternal(null);
      return;
    }
    const created = createDefaultParserService();
    setInternal(created);
    return () => {
      created.dispose();
    };
  }, [externalService]);

  return externalService ?? internal;
}

export function AppProvider({ children, parserService }: AppProviderProps): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const parser = useParserService(parserService);

  // Fetch operations + visual elements whenever the current page changes.
  //
  // The effect creates an AbortController on each run and aborts it during
  // cleanup. We thread its signal into parser.getPageOperations so the
  // ParserService implementation can stop work (worker-side cancellation
  // for WorkerParserService, throwIfAborted gates for InProcess). We also
  // suppress the dispatch when the controller was aborted to avoid
  // committing stale results into the reducer.
  useEffect(() => {
    if (!parser) return;
    if (state.document.status !== "loaded") return;
    if (!state.document.analysis.pages[state.currentPage - 1]) return;
    if (
      state.pageOps.status === "loaded" &&
      state.pageOps.result.pageNumber === state.currentPage
    ) {
      return;
    }

    const controller = new AbortController();
    const target = state.currentPage;
    dispatch({ type: "pageOpsStart", pageNumber: target });
    parser
      .getPageOperations(target, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        dispatch({ type: "pageOpsSuccess", result });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        // Surface AbortError as a silent no-op (it's our own cleanup).
        if (err instanceof DOMException && err.name === "AbortError") return;
        dispatch({
          type: "pageOpsError",
          pageNumber: target,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      controller.abort();
    };
  }, [state.document, state.currentPage, state.pageOps, parser]);

  // Don't render children until the parser is available — the worker is
  // created in a commit-phase effect, so the very first render before the
  // effect commits has parser === null. Tests that supply parserService
  // see a non-null parser immediately and skip this branch.
  if (!parser) {
    return <div data-testid="app-bootstrapping" />;
  }

  return (
    <ParserContext.Provider value={parser}>
      <DispatchContext.Provider value={dispatch}>
        <StateContext.Provider value={state}>{children}</StateContext.Provider>
      </DispatchContext.Provider>
    </ParserContext.Provider>
  );
}

export function useAppState(): AppState {
  const state = useContext(StateContext);
  if (!state) throw new Error("useAppState must be used inside <AppProvider>");
  return state;
}

export function useAppDispatch(): React.Dispatch<Action> {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) throw new Error("useAppDispatch must be used inside <AppProvider>");
  return dispatch;
}

export function useParser(): ParserService {
  const parser = useContext(ParserContext);
  if (!parser) throw new Error("useParser must be used inside <AppProvider>");
  return parser;
}

/**
 * Convenience hook joining state + dispatch + parser. Use when a component
 * legitimately needs all three; otherwise prefer the slice-specific hooks
 * above so you only rerender on the slice that matters.
 */
export function useApp(): AppContextValue {
  return {
    state: useAppState(),
    dispatch: useAppDispatch(),
    parser: useParser(),
  };
}
