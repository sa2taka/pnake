/**
 * Wire protocol between the main thread and the parser worker.
 * The shape MUST be structured-clone-safe (no functions, no class instances).
 */

import type {
  ObjectId,
  PdfAnalysis,
  PdfObjectDetail,
  PdfOperation,
  PdfResolvedResources,
  PdfVisualElement,
  PdfWarning,
} from "./ir-types";

// =============================================================================
// Requests (main -> worker)
// =============================================================================

export type WorkerRequest =
  | { id: number; type: "ping"; payload?: unknown }
  | { id: number; type: "load"; bytes: ArrayBuffer; fileName?: string }
  | { id: number; type: "getObjectDetail"; objectId: ObjectId }
  | {
      id: number;
      type: "getStream";
      objectId: ObjectId;
      mode: "raw" | "decoded";
    }
  | { id: number; type: "getPageOperations"; pageNumber: number }
  | { id: number; type: "cancel"; targetId: number };

// =============================================================================
// Responses (worker -> main)
// =============================================================================

export interface WorkerError {
  name: string;
  message: string;
  stack?: string;
}

export type LoadResult = {
  analysis: PdfAnalysis;
};

export type StreamResult = {
  bytes: ArrayBuffer;
  decoded: boolean;
  truncated: boolean;
};

export type PageOperationsResult = {
  pageNumber: number;
  operations: PdfOperation[];
  warnings: PdfWarning[];
  resources: PdfResolvedResources;
  visualElements: PdfVisualElement[];
};

export type WorkerResponse =
  | { id: number; ok: true; type: "pong"; result: unknown }
  | { id: number; ok: true; type: "loaded"; result: LoadResult }
  | { id: number; ok: true; type: "objectDetail"; result: PdfObjectDetail }
  | { id: number; ok: true; type: "stream"; result: StreamResult }
  | { id: number; ok: true; type: "pageOperations"; result: PageOperationsResult }
  | { id: number; ok: false; error: WorkerError }
  | { id: number; progress: number; phase?: string };

// =============================================================================
// Error serialization
// =============================================================================

export function serializeError(err: unknown): WorkerError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "UnknownError", message: String(err) };
}
