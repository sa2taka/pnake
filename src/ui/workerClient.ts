/**
 * Typed facade over the parser worker.
 *
 * Owns the Worker instance, correlates request/response ids, and
 * surfaces a Promise-based API for the UI layer. The generic on
 * `call()` is driven by the method name, so the result type is
 * derived from `RpcMethods` and callers cannot ask for the wrong T.
 */

import type {
  LoadResult,
  PageOperationsResult,
  RpcMethod,
  RpcParams,
  RpcResult,
  StreamResult,
  WorkerRequest,
  WorkerResponse,
} from "../shared/protocol";
import type { ObjectId, PdfObjectDetail } from "../shared/ir-types";

export interface CallOptions {
  onProgress?: (progress: number, phase?: string) => void;
  signal?: AbortSignal;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  onProgress?: (progress: number, phase?: string) => void;
};

export class WorkerClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /**
   * The client transitions to "dead" after a fatal Worker error or an
   * explicit terminate(). Once dead, all subsequent calls reject
   * immediately so callers get a fast, deterministic failure instead of
   * waiting on a Worker that will never reply.
   */
  private closed = false;
  private closedReason: Error | null = null;

  constructor(private worker: Worker) {
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleError);
  }

  static spawn(): WorkerClient {
    const worker = new Worker(new URL("../worker/index.ts", import.meta.url), {
      type: "module",
      name: "pnake-parser",
    });
    return new WorkerClient(worker);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.closedReason = new Error("Worker terminated");
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleError);
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(this.closedReason);
    this.pending.clear();
  }

  ping(payload: unknown = null, options: CallOptions = {}): Promise<unknown> {
    return this.call("ping", { payload }, undefined, options);
  }

  load(
    bytes: ArrayBuffer,
    fileName?: string,
    options: CallOptions = {},
  ): Promise<LoadResult> {
    return this.call("load", { bytes, fileName }, [bytes], options);
  }

  getObjectDetail(objectId: ObjectId, options: CallOptions = {}): Promise<PdfObjectDetail> {
    return this.call("getObjectDetail", { objectId }, undefined, options);
  }

  getStream(
    objectId: ObjectId,
    mode: "raw" | "decoded",
    options: CallOptions = {},
  ): Promise<StreamResult> {
    return this.call("getStream", { objectId, mode }, undefined, options);
  }

  getPageOperations(
    pageNumber: number,
    options: CallOptions = {},
  ): Promise<PageOperationsResult> {
    return this.call("getPageOperations", { pageNumber }, undefined, options);
  }

  private call<M extends RpcMethod>(
    method: M,
    params: RpcParams<M>,
    transfer: Transferable[] | undefined,
    options: CallOptions,
  ): Promise<RpcResult<M>> {
    if (this.closed) {
      return Promise.reject(this.closedReason ?? new Error("Worker is closed"));
    }
    const id = this.nextId++;
    return new Promise<RpcResult<M>>((resolve, reject) => {
      this.pending.set(id, {
        // The Pending map stores heterogeneous request types behind a single
        // entry shape; the cast here is the one inherent variance point.
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: options.onProgress,
      });

      if (options.signal) {
        if (options.signal.aborted) {
          this.pending.delete(id);
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        options.signal.addEventListener(
          "abort",
          () => {
            if (this.pending.has(id)) {
              this.pending.delete(id);
              this.worker.postMessage({
                id: this.nextId++,
                type: "cancel",
                targetId: id,
              });
              reject(new DOMException("Aborted", "AbortError"));
            }
          },
          { once: true },
        );
      }

      const message: WorkerRequest = { id, type: method, ...params } as WorkerRequest;
      if (transfer && transfer.length > 0) {
        this.worker.postMessage(message, transfer);
      } else {
        this.worker.postMessage(message);
      }
    });
  }

  private handleMessage = (event: MessageEvent<WorkerResponse>): void => {
    const msg = event.data;
    const entry = this.pending.get(msg.id);
    if (!entry) return;

    if ("progress" in msg) {
      entry.onProgress?.(msg.progress, msg.phase);
      return;
    }

    this.pending.delete(msg.id);
    if (msg.ok) {
      entry.resolve(msg.result);
    } else {
      const err = new Error(msg.error.message);
      err.name = msg.error.name;
      if (msg.error.stack) err.stack = msg.error.stack;
      entry.reject(err);
    }
  };

  private handleError = (event: ErrorEvent): void => {
    // A bubbled ErrorEvent from the Worker is treated as a fatal failure:
    // we can't tell whether the worker can keep running, and our protocol
    // assumes one outstanding state per id, so we close the client to
    // surface the failure to all pending callers AND any future ones.
    this.closed = true;
    this.closedReason = new Error(event.message || "Worker fatal error");
    for (const p of this.pending.values()) p.reject(this.closedReason);
    this.pending.clear();
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleError);
  };
}
