/**
 * Wire protocol between the main thread and the parser worker.
 * The shape MUST be structured-clone-safe (no functions, no class instances).
 *
 * The single source of truth is `RpcMethods` — adding a new method is one
 * entry, not five hand-rolled union arms. Request and success envelopes
 * are derived; only the out-of-band `cancel` request lives outside the
 * map because it targets another request by id rather than returning its
 * own result.
 */

import type {
  ObjectId,
  PdfAnalysis,
  PdfObjectDetail,
  PdfOperation,
  PdfResolvedResources,
  PdfStructTree,
  PdfVisualElement,
  PdfWarning,
} from "./ir-types";

export type LoadResult = {
  analysis: PdfAnalysis;
  structTree?: PdfStructTree;
}

export type StreamResult = {
  bytes: ArrayBuffer;
  decoded: boolean;
  truncated: boolean;
}

export type PageOperationsResult = {
  pageNumber: number;
  operations: PdfOperation[];
  warnings: PdfWarning[];
  resources: PdfResolvedResources;
  visualElements: PdfVisualElement[];
}

// Method map — single source of truth for request / response shape.
export type RpcMethods = {
  ping: { params: { payload?: unknown }; result: unknown };
  load: { params: { bytes: ArrayBuffer; fileName?: string }; result: LoadResult };
  getObjectDetail: { params: { objectId: ObjectId }; result: PdfObjectDetail };
  getStream: {
    params: { objectId: ObjectId; mode: "raw" | "decoded" };
    result: StreamResult;
  };
  getPageOperations: {
    params: { pageNumber: number };
    result: PageOperationsResult;
  };
}

export type RpcMethod = keyof RpcMethods;
export type RpcParams<M extends RpcMethod> = RpcMethods[M]["params"];
export type RpcResult<M extends RpcMethod> = RpcMethods[M]["result"];

// Wire envelopes (derived).
type RpcRequest = {
  [K in RpcMethod]: { id: number; type: K } & RpcParams<K>;
}[RpcMethod];

/**
 * Out-of-band cancellation message. Not part of RpcMethods because it
 * targets another request by id rather than returning its own result.
 */
export type CancelRequest = { id: number; type: "cancel"; targetId: number }

export type WorkerRequest = RpcRequest | CancelRequest;

type RpcSuccess = {
  [K in RpcMethod]: { id: number; ok: true; type: K; result: RpcResult<K> };
}[RpcMethod];

export type WorkerError = {
  name: string;
  message: string;
  stack?: string;
}

export type WorkerErrorResponse = { id: number; ok: false; error: WorkerError }

export type WorkerResponse = RpcSuccess | WorkerErrorResponse;

export function serializeError(err: unknown): WorkerError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "UnknownError", message: String(err) };
}
