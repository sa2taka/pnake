/**
 * Transport-neutral PDF parsing session.
 *
 * This class lives in `src/core/` so both the Worker dispatcher and
 * the in-process ParserService implementation can share it without
 * crossing the UI ↔ worker boundary. The worker entry adapts message
 * events onto this class; the InProcessParserService talks to it
 * directly on the main thread.
 *
 * No DOM, no worker-only globals are referenced — anything that
 * needs them belongs in a transport adapter, not here.
 */

import type {
  ObjectId,
  PdfDict,
  PdfFilter,
  PdfObjectDetail,
  PdfValue,
} from "../shared/ir-types";
import type { LoadResult, PageOperationsResult, StreamResult } from "../shared/protocol";
import { ByteReader, asciiString } from "../worker/pdf/io/byte-reader";
import { parseContentStream } from "../worker/pdf/content/parser";
import { buildVisualElements } from "../worker/pdf/content/visual-elements";
import type { IndirectObject } from "../worker/pdf/parse/object-reader";
import { extractFilters } from "../worker/pdf/parse/value-parser";
import { resolveResources } from "../worker/pdf/resources/resolver";
import { parseToUnicodeCMap, type ToUnicodeCMap } from "../worker/pdf/resources/cmap";
import { decodeStream, extractDecodeParms } from "../worker/pdf/streams/decode";
import { parsePdf } from "../worker/pdf/structure/manifest";
import { buildStructTree } from "../worker/pdf/structure/struct-tree";
import { LruCache } from "./lru-cache";

interface State {
  bytes: Uint8Array;
  reader: ByteReader;
  objects: Map<ObjectId, IndirectObject>;
  analysis: LoadResult;
  sessionId: number;
}

/**
 * Raised when a handler discovers, after returning from an `await`, that
 * a newer `load()` has superseded the document it was operating on. The
 * worker dispatcher returns this as a structured error to the main
 * thread, where the WorkerClient settles only the active request — old
 * requests already have an in-flight rejection of their own.
 */
export class StaleSessionError extends Error {
  readonly name = "StaleSessionError";
  constructor(operation: string, oldSession: number, newSession: number) {
    super(
      `Operation ${operation} dropped: session ${oldSession} was superseded by ${newSession}.`,
    );
  }
}

export class ParserSession {
  private state?: State;
  /** Monotonic id bumped on every load() entry (not completion). */
  private currentSessionId = 0;
  private decodedCache = new LruCache<ObjectId, Uint8Array>(32);

  async load(buffer: ArrayBuffer): Promise<LoadResult> {
    const session = ++this.currentSessionId;
    const bytes = new Uint8Array(buffer);
    const { analysis, objects, reader } = await parsePdf(bytes);
    if (session !== this.currentSessionId) {
      throw new StaleSessionError("load", session, this.currentSessionId);
    }
    const structTreeRoot = analysis.documentTree?.structTreeRootRef;
    const structTree = structTreeRoot
      ? buildStructTree({ structTreeRootRef: structTreeRoot, objects })
      : undefined;
    const result: LoadResult = structTree
      ? { analysis, structTree }
      : { analysis };
    this.state = {
      bytes,
      reader,
      objects,
      analysis: result,
      sessionId: session,
    };
    this.decodedCache.clear();
    return this.state.analysis;
  }

  /** Re-emit the manifest (after the original transferable was consumed). */
  getAnalysis(): LoadResult {
    return this.require().analysis;
  }

  getObjectDetail(objectId: ObjectId): PdfObjectDetail {
    const s = this.require();
    const summary = s.analysis.analysis.objectsIndex[objectId];
    const obj = s.objects.get(objectId);
    if (!summary || !obj) {
      throw new Error(`Object not found: ${objectId}`);
    }
    return {
      ...summary,
      value: stripStreamBytes(obj.value),
      rawText: rawTextOf(obj, s.bytes),
    };
  }

  async getStream(objectId: ObjectId, mode: "raw" | "decoded"): Promise<StreamResult> {
    const s = this.require();
    const session = s.sessionId;
    const obj = s.objects.get(objectId);
    if (!obj) throw new Error(`Object not found: ${objectId}`);
    if (obj.value.kind !== "stream") {
      // Compressed objects (from ObjStm) and non-stream values land here:
      // the caller should fetch them via getObjectDetail instead.
      throw new Error(`Object ${objectId} is not a stream`);
    }
    if (!obj.streamRange) {
      throw new Error(`Object ${objectId} stream has no range`);
    }

    const raw = s.bytes.subarray(obj.streamRange.start, obj.streamRange.end);
    if (mode === "raw") {
      const copy = raw.slice();
      return { bytes: copy.buffer, decoded: false, truncated: false };
    }
    const decoded = await this.decodeCached(
      objectId,
      raw,
      obj.value.handle.filters,
      obj.value.dict,
    );
    if (session !== this.currentSessionId) {
      throw new StaleSessionError("getStream", session, this.currentSessionId);
    }
    const transfer = decoded.slice();
    return { bytes: transfer.buffer, decoded: true, truncated: false };
  }

  private async decodeCached(
    objectId: ObjectId,
    raw: Uint8Array,
    filters: PdfFilter[],
    streamDict: PdfDict,
  ): Promise<Uint8Array> {
    const cached = this.decodedCache.get(objectId);
    if (cached) return cached;
    const decoded = await decodeStream(raw, filters, extractDecodeParms(streamDict));
    this.decodedCache.set(objectId, decoded);
    return decoded;
  }

  async getPageOperations(pageNumber: number): Promise<PageOperationsResult> {
    const s = this.require();
    const session = s.sessionId;
    const page = s.analysis.analysis.pages[pageNumber - 1];
    if (!page) throw new Error(`Page ${pageNumber} not found`);

    // /Contents may be missing, a single ref, or an array of refs. We
    // concatenate the decoded bytes from each referenced stream object.
    const allBytes: Uint8Array[] = [];
    const allWarnings: PageOperationsResult["warnings"] = [];
    for (const ref of page.contentStreamRefs) {
      const obj = s.objects.get(ref);
      if (!obj) {
        allWarnings.push({
          id: `warn:contents-missing:${ref}`,
          severity: "warn",
          category: "structure",
          message: `Page ${pageNumber} references missing content object ${ref}`,
        });
        continue;
      }
      if (obj.value.kind !== "stream" || !obj.streamRange) {
        allWarnings.push({
          id: `warn:contents-not-stream:${ref}`,
          severity: "warn",
          category: "structure",
          message: `Content object ${ref} is not a stream`,
        });
        continue;
      }
      const dict = obj.value.dict;
      const raw = s.bytes.subarray(obj.streamRange.start, obj.streamRange.end);
      try {
        const decoded = await decodeStream(raw, extractFilters(dict), extractDecodeParms(dict));
        allBytes.push(decoded);
      } catch (err) {
        allWarnings.push({
          id: `warn:contents-decode:${ref}`,
          severity: "warn",
          category: "stream",
          message: `Failed to decode content stream ${ref}: ${(err as Error).message}`,
        });
      }
    }
    // Resolve resources first so parseContentStream can look up /Properties
    // referenced by name in BDC operators.
    const resources = resolveResources({
      pageNumber,
      resourceRef: page.resourceRef,
      resourceDict: page.resourceDict,
      objects: s.objects,
    });

    const combined = concatBytes(allBytes);
    const { operations, warnings } = parseContentStream(combined, pageNumber, {
      properties: resources.properties,
    });

    // Decode ToUnicode CMaps for each font; failures degrade gracefully.
    const fontCMaps = new Map<string, ToUnicodeCMap>();
    for (const [name, font] of Object.entries(resources.fonts)) {
      if (!font.toUnicodeRef) continue;
      try {
        const cmapBytes = await this.decodeStreamObject(font.toUnicodeRef);
        if (cmapBytes) {
          fontCMaps.set(name, parseToUnicodeCMap(cmapBytes));
        }
      } catch (err) {
        allWarnings.push({
          id: `warn:cmap-decode:${font.toUnicodeRef}`,
          severity: "info",
          category: "encoding",
          message: `ToUnicode CMap for /${name} failed: ${(err as Error).message}`,
        });
      }
    }

    const { elements: visualElements, warnings: vwarnings } = buildVisualElements({
      pageNumber,
      operations,
      resources,
      fontCMaps,
    });

    if (session !== this.currentSessionId) {
      throw new StaleSessionError("getPageOperations", session, this.currentSessionId);
    }

    return {
      pageNumber,
      operations,
      resources,
      visualElements,
      warnings: [...allWarnings, ...warnings, ...vwarnings],
    };
  }

  private async decodeStreamObject(objectId: ObjectId): Promise<Uint8Array | null> {
    const s = this.require();
    const obj = s.objects.get(objectId);
    if (!obj || obj.value.kind !== "stream" || !obj.streamRange) return null;
    const dict = obj.value.dict;
    const raw = s.bytes.subarray(obj.streamRange.start, obj.streamRange.end);
    return this.decodeCached(objectId, raw, extractFilters(dict), dict);
  }

  private require(): State {
    if (!this.state) throw new Error("No PDF loaded");
    return this.state;
  }
}

/** Strip stream bytes from a PdfValue so the structured-clone payload is small. */
function stripStreamBytes(value: PdfValue): PdfValue {
  if (value.kind === "stream") {
    return { kind: "stream", dict: value.dict, handle: value.handle };
  }
  return value;
}

function rawTextOf(obj: IndirectObject, bytes: Uint8Array): string {
  // Slice the header bytes (up to /endobj). Truncate to keep manifest small.
  const MAX = 2048;
  const start = obj.range.start;
  const end = Math.min(obj.range.end, start + MAX);
  const text = asciiString(bytes.subarray(start, end));
  if (obj.range.end > end) return text + "\n…";
  return text;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
