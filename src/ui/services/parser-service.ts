/**
 * UI-side facade in front of the parser worker.
 *
 * Two implementations:
 *   - WorkerParserService: spawns a real Web Worker (production).
 *   - InProcessParserService: runs ParserSession on the main thread,
 *     useful for tests in jsdom and as a fallback in environments
 *     where Workers aren't available.
 *
 * Both expose the same Promise-based ParserService interface so the
 * rest of the UI never knows which one it is talking to.
 */

import type { ObjectId, PdfObjectDetail } from "../../shared/ir-types";
import type {
  LoadResult,
  PageOperationsResult,
  StreamResult,
} from "../../shared/protocol";
import { ParserSession } from "../../core/parser-session";
import { WorkerClient } from "../workerClient";

/**
 * Transport-agnostic call options.
 *
 * The Worker implementation forwards these to WorkerClient, which sends
 * an out-of-band `cancel` message when the signal aborts. (Today the
 * worker treats `cancel` as a no-op — the caller's promise rejects, but
 * the worker keeps running.)
 *
 * The in-process implementation honours `signal` by throwing AbortError
 * at the natural async boundaries. `onProgress` is reserved for future
 * streaming progress; neither implementation invokes it yet.
 */
export interface CallOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number, phase?: string) => void;
}

export interface ParserService {
  load(
    buffer: ArrayBuffer,
    fileName?: string,
    options?: CallOptions,
  ): Promise<LoadResult>;
  getObjectDetail(objectId: ObjectId, options?: CallOptions): Promise<PdfObjectDetail>;
  getStream(
    objectId: ObjectId,
    mode: "raw" | "decoded",
    options?: CallOptions,
  ): Promise<StreamResult>;
  getPageOperations(pageNumber: number, options?: CallOptions): Promise<PageOperationsResult>;
  dispose(): void;
}

export class WorkerParserService implements ParserService {
  private readonly client = WorkerClient.spawn();

  load(
    buffer: ArrayBuffer,
    fileName?: string,
    options?: CallOptions,
  ): Promise<LoadResult> {
    return this.client.load(buffer, fileName, options);
  }

  getObjectDetail(
    objectId: ObjectId,
    options?: CallOptions,
  ): Promise<PdfObjectDetail> {
    return this.client.getObjectDetail(objectId, options);
  }

  getStream(
    objectId: ObjectId,
    mode: "raw" | "decoded",
    options?: CallOptions,
  ): Promise<StreamResult> {
    return this.client.getStream(objectId, mode, options);
  }

  getPageOperations(
    pageNumber: number,
    options?: CallOptions,
  ): Promise<PageOperationsResult> {
    return this.client.getPageOperations(pageNumber, options);
  }

  dispose(): void {
    this.client.terminate();
  }
}

export class InProcessParserService implements ParserService {
  private readonly session = new ParserSession();

  async load(
    buffer: ArrayBuffer,
    _fileName?: string,
    options?: CallOptions,
  ): Promise<LoadResult> {
    throwIfAborted(options?.signal);
    const result = await this.session.load(buffer);
    throwIfAborted(options?.signal);
    return result;
  }

  async getObjectDetail(
    objectId: ObjectId,
    options?: CallOptions,
  ): Promise<PdfObjectDetail> {
    throwIfAborted(options?.signal);
    return this.session.getObjectDetail(objectId);
  }

  async getStream(
    objectId: ObjectId,
    mode: "raw" | "decoded",
    options?: CallOptions,
  ): Promise<StreamResult> {
    throwIfAborted(options?.signal);
    const result = await this.session.getStream(objectId, mode);
    throwIfAborted(options?.signal);
    return result;
  }

  async getPageOperations(
    pageNumber: number,
    options?: CallOptions,
  ): Promise<PageOperationsResult> {
    throwIfAborted(options?.signal);
    const result = await this.session.getPageOperations(pageNumber);
    throwIfAborted(options?.signal);
    return result;
  }

  dispose(): void {
    /* nothing to clean up */
  }
}

export function createDefaultParserService(): ParserService {
  // Workers are unavailable in some test/SSR contexts; fall back.
  if (typeof Worker === "undefined") return new InProcessParserService();
  try {
    return new WorkerParserService();
  } catch {
    return new InProcessParserService();
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
