/**
 * UI-side facade in front of the parser worker.
 *
 * Two implementations:
 *   - WorkerParserService: spawns a real Web Worker (production).
 *   - InProcessParserService: runs ParserState on the main thread,
 *     useful for tests in jsdom and as a fallback in environments
 *     where Workers aren't available.
 *
 * Both expose the same Promise-based ParserService interface so the
 * rest of the UI never knows which one it is talking to.
 */

import type { ObjectId, PdfAnalysis, PdfObjectDetail } from "../../shared/ir-types";
import type { StreamResult } from "../../shared/protocol";
import { ParserState } from "../../worker/handlers";
import { WorkerClient } from "../workerClient";

export interface ParserService {
  load(buffer: ArrayBuffer, fileName?: string): Promise<PdfAnalysis>;
  getObjectDetail(objectId: ObjectId): Promise<PdfObjectDetail>;
  getStream(objectId: ObjectId, mode: "raw" | "decoded"): Promise<StreamResult>;
  dispose(): void;
}

export class WorkerParserService implements ParserService {
  private readonly client = WorkerClient.spawn();

  async load(buffer: ArrayBuffer, fileName?: string): Promise<PdfAnalysis> {
    const { analysis } = await this.client.load(buffer, fileName);
    return analysis;
  }

  getObjectDetail(objectId: ObjectId): Promise<PdfObjectDetail> {
    return this.client.getObjectDetail(objectId);
  }

  getStream(objectId: ObjectId, mode: "raw" | "decoded"): Promise<StreamResult> {
    return this.client.getStream(objectId, mode);
  }

  dispose(): void {
    this.client.terminate();
  }
}

export class InProcessParserService implements ParserService {
  private readonly state = new ParserState();

  async load(buffer: ArrayBuffer): Promise<PdfAnalysis> {
    const { analysis } = await this.state.load(buffer);
    return analysis;
  }

  async getObjectDetail(objectId: ObjectId): Promise<PdfObjectDetail> {
    return this.state.getObjectDetail(objectId);
  }

  getStream(objectId: ObjectId, mode: "raw" | "decoded"): Promise<StreamResult> {
    return this.state.getStream(objectId, mode);
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
