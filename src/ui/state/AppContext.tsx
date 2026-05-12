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
  useMemo,
  useReducer,
  useRef,
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
      return { ...initialState, status: "loading", fileName: action.fileName };
    case "loadSuccess":
      return {
        ...state,
        status: "loaded",
        analysis: action.analysis,
        structTree: action.structTree,
        fileName: action.fileName ?? state.fileName,
        fileBytes: action.fileBytes ?? state.fileBytes,
        error: undefined,
        selectedNodeId: firstSelectableId(action.analysis),
        currentPage: 1,
      };
    case "loadError":
      return { ...state, status: "error", error: action.error };
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
      };
    case "pageOpsStart":
      return {
        ...state,
        currentPage: action.pageNumber,
        pageOperationsStatus: "loading",
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

export function AppProvider({ children, parserService }: AppProviderProps): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const ownedRef = useRef<ParserService | null>(null);

  const parser = useMemo(() => {
    if (parserService) {
      ownedRef.current = null; // caller owns disposal
      return parserService;
    }
    const created = createDefaultParserService();
    ownedRef.current = created;
    return created;
  }, [parserService]);

  useEffect(() => {
    return () => {
      ownedRef.current?.dispose();
      ownedRef.current = null;
    };
  }, []);

  // Fetch operations + visual elements whenever the current page changes.
  //
  // We deliberately do not depend on pageOperationsStatus: the dispatch we
  // perform inside this effect would otherwise cancel its own in-flight
  // request as the status flips idle → loading and the effect re-runs.
  // Instead, an inFlight ref tracks which page is being fetched.
  const inFlightRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.status !== "loaded") return;
    if (!state.analysis?.pages[state.currentPage - 1]) return;
    if (state.pageOperations?.pageNumber === state.currentPage) return;
    if (inFlightRef.current === state.currentPage) return;

    const target = state.currentPage;
    inFlightRef.current = target;
    dispatch({ type: "pageOpsStart", pageNumber: target });
    parser
      .getPageOperations(target)
      .then((result) => {
        if (inFlightRef.current !== target) return;
        inFlightRef.current = null;
        dispatch({ type: "pageOpsSuccess", result });
      })
      .catch((err) => {
        if (inFlightRef.current !== target) return;
        inFlightRef.current = null;
        dispatch({
          type: "pageOpsError",
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, [state.status, state.currentPage, state.analysis, state.pageOperations, parser]);

  const value = useMemo<AppContextValue>(
    () => ({ state, dispatch, parser }),
    [state, parser],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}
