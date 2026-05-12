/**
 * Typed facade over the parser worker.
 *
 * Owns the Worker instance, correlates request/response ids, and
 * surfaces a Promise-based API for the UI layer.
 */

import type {
  LoadResult,
  PageOperationsResult,
  StreamResult,
  WorkerRequest,
  WorkerResponse,
} from "../shared/protocol";
import type { PdfObjectDetail } from "../shared/ir-types";

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<WorkerRequest, "id">;

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

  terminate(): void {
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleError);
    this.worker.terminate();
    const err = new Error("Worker terminated");
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  ping(payload: unknown = null, options: CallOptions = {}): Promise<unknown> {
    return this.call({ type: "ping", payload }, undefined, options);
  }

  load(
    bytes: ArrayBuffer,
    fileName?: string,
    options: CallOptions = {},
  ): Promise<LoadResult> {
    return this.call<LoadResult>(
      { type: "load", bytes, fileName },
      [bytes],
      options,
    );
  }

  getObjectDetail(objectId: string, options: CallOptions = {}): Promise<PdfObjectDetail> {
    return this.call<PdfObjectDetail>({ type: "getObjectDetail", objectId }, undefined, options);
  }

  getStream(
    objectId: string,
    mode: "raw" | "decoded",
    options: CallOptions = {},
  ): Promise<StreamResult> {
    return this.call<StreamResult>({ type: "getStream", objectId, mode }, undefined, options);
  }

  getPageOperations(
    pageNumber: number,
    options: CallOptions = {},
  ): Promise<PageOperationsResult> {
    return this.call<PageOperationsResult>(
      { type: "getPageOperations", pageNumber },
      undefined,
      options,
    );
  }

  private call<T>(
    req: RequestBody,
    transfer: Transferable[] | undefined,
    options: CallOptions,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
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
              this.worker.postMessage({ id: this.nextId++, type: "cancel", targetId: id });
              reject(new DOMException("Aborted", "AbortError"));
            }
          },
          { once: true },
        );
      }

      const message = { ...req, id } as WorkerRequest;
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
    const err = new Error(event.message);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  };
}
