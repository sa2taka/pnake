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
import type { PdfAnalysis } from "../../shared/ir-types";
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
  analysis?: PdfAnalysis;
  error?: string;
  selectedNodeId?: string;
  selectionOrigin: SelectionOrigin;
  treeView: TreeViewMode;
  bottomTab: BottomTab;
  bottomOpen: boolean;
}

type Action =
  | { type: "loadStart"; fileName?: string }
  | { type: "loadSuccess"; analysis: PdfAnalysis; fileName?: string }
  | { type: "loadError"; error: string }
  | { type: "select"; nodeId: string | undefined; origin: SelectionOrigin }
  | { type: "setTreeView"; mode: TreeViewMode }
  | { type: "setBottomTab"; tab: BottomTab }
  | { type: "toggleBottom" }
  | { type: "setBottomOpen"; open: boolean };

export const initialState: AppState = {
  status: "idle",
  selectionOrigin: "tree",
  treeView: "objects",
  bottomTab: "raw",
  bottomOpen: false,
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
        fileName: action.fileName ?? state.fileName,
        error: undefined,
        selectedNodeId: firstSelectableId(action.analysis),
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
