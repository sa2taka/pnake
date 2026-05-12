/**
 * Application state.
 *
 * One reducer keeps every cross-pane state in one place; per-pane
 * state (e.g. row hover, scroll position) stays local to that pane.
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

export interface AppState {
  status: "idle" | "loading" | "loaded" | "error";
  fileName?: string;
  fileBytes?: ArrayBuffer;
  analysis?: PdfAnalysis;
  structTree?: PdfStructTree;
  error?: string;
  selectedNodeId?: string;
  selectionOrigin: SelectionOrigin;
  treeView: TreeViewMode;
  bottomTab: BottomTab;
  bottomOpen: boolean;
  currentPage: number;
  pageOperations?: PageOperationsResult;
  pageOperationsStatus: "idle" | "loading" | "loaded" | "error";
  pageOperationsError?: string;
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
  | { type: "pageOpsError"; error: string };

export const initialState: AppState = {
  status: "idle",
  selectionOrigin: "tree",
  treeView: "objects",
  bottomTab: "raw",
  bottomOpen: false,
  currentPage: 1,
  pageOperationsStatus: "idle",
};

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "loadStart":
      // Drop EVERY load-derived field when a new file starts loading — the
      // previous analysis, structTree, fileBytes, and any in-flight error
      // must not bleed into the next document.
      return {
        ...initialState,
        status: "loading",
        ...(action.fileName ? { fileName: action.fileName } : {}),
      };
    case "loadSuccess":
      return {
        ...state,
        status: "loaded",
        analysis: action.analysis,
        ...(action.structTree
          ? { structTree: action.structTree }
          : { structTree: undefined }),
        ...(action.fileName ? { fileName: action.fileName } : {}),
        ...(action.fileBytes ? { fileBytes: action.fileBytes } : {}),
        error: undefined,
        selectedNodeId: firstSelectableId(action.analysis),
        currentPage: 1,
        pageOperations: undefined,
        pageOperationsStatus: "idle",
        pageOperationsError: undefined,
      };
    case "loadError":
      // Keep the file name so the toolbar can still show which file failed,
      // but clear analysis-derived state so consumers cannot read stale data.
      return {
        ...state,
        status: "error",
        error: action.error,
        analysis: undefined,
        structTree: undefined,
        pageOperations: undefined,
        pageOperationsStatus: "idle",
      };
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
        pageOperations: undefined,
        pageOperationsStatus: "idle",
        pageOperationsError: undefined,
      };
    case "pageOpsStart":
      return {
        ...state,
        currentPage: action.pageNumber,
        pageOperationsStatus: "loading",
        pageOperationsError: undefined,
      };
    case "pageOpsSuccess":
      return {
        ...state,
        pageOperations: action.result,
        pageOperationsStatus: "loaded",
        pageOperationsError: undefined,
      };
    case "pageOpsError":
      return {
        ...state,
        pageOperationsStatus: "error",
        pageOperationsError: action.error,
        pageOperations: undefined,
      };
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

// =============================================================================
// Type guards
// =============================================================================
//
// The flat AppState shape doesn't constrain combinations like `status:
// "loaded" + analysis: undefined` at the type level — the reducer is the
// invariant gatekeeper. Until we restructure into discriminated unions,
// these guards give consumers a single, typed entry point instead of
// independent `state.status === "loaded" && state.analysis` checks
// scattered through every panel.

export function isAnalysisLoaded(
  state: AppState,
): state is AppState & { status: "loaded"; analysis: PdfAnalysis } {
  return state.status === "loaded" && state.analysis !== undefined;
}

export function isPageOpsLoaded(
  state: AppState,
): state is AppState & {
  pageOperationsStatus: "loaded";
  pageOperations: PageOperationsResult;
} {
  return state.pageOperationsStatus === "loaded" && state.pageOperations !== undefined;
}

function firstSelectableId(analysis: PdfAnalysis): string | undefined {
  return analysis.documentTree?.catalogRef ?? Object.keys(analysis.objectsIndex)[0];
}

// =============================================================================
// Context
// =============================================================================

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  parser: ParserService;
}

const AppContext = createContext<AppContextValue | null>(null);

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
    if (state.status !== "loaded") return;
    if (!state.analysis?.pages[state.currentPage - 1]) return;
    if (state.pageOperations?.pageNumber === state.currentPage) return;

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
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      controller.abort();
    };
  }, [state.status, state.currentPage, state.analysis, state.pageOperations, parser]);

  // Don't render children until the parser is available — the worker is
  // created in a commit-phase effect, so the very first render before the
  // effect commits has parser === null. Tests that supply parserService
  // see a non-null parser immediately and skip this branch.
  if (!parser) {
    return <div data-testid="app-bootstrapping" />;
  }

  const value: AppContextValue = { state, dispatch, parser };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}
