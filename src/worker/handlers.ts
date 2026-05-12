/**
 * Worker-side state and handlers.
 *
 * Exposed as a class so we can construct it in tests without spinning
 * up a real worker thread.
 */

import type {
  ObjectId,
  PdfDict,
  PdfFilter,
  PdfObjectDetail,
  PdfValue,
} from "../shared/ir-types";
import type { LoadResult, PageOperationsResult, StreamResult } from "../shared/protocol";
import { ByteReader, asciiString } from "./pdf/io/byte-reader";
import { parseContentStream } from "./pdf/content/parser";
import { buildVisualElements } from "./pdf/content/visual-elements";
import type { IndirectObject } from "./pdf/parse/object-reader";
import { extractFilters } from "./pdf/parse/value-parser";
import { resolveResources } from "./pdf/resources/resolver";
import { parseToUnicodeCMap, type ToUnicodeCMap } from "./pdf/resources/cmap";
import { decodeStream, extractDecodeParms } from "./pdf/streams/decode";
import { parsePdf } from "./pdf/structure/manifest";
import { buildStructTree } from "./pdf/structure/struct-tree";
import { LruCache } from "./lru-cache";

interface State {
  bytes: Uint8Array;
  reader: ByteReader;
  objects: Map<ObjectId, IndirectObject>;
  analysisJson: LoadResult;
}

export class ParserState {
  private state?: State;
  private decodedCache = new LruCache<ObjectId, Uint8Array>(32);

  async load(buffer: ArrayBuffer): Promise<LoadResult> {
    const bytes = new Uint8Array(buffer);
    const { analysis, objects, reader } = await parsePdf(bytes);
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
      analysisJson: result,
    };
    this.decodedCache.clear();
    return this.state.analysisJson;
  }

  /** Re-emit the manifest (after the original transferable was consumed). */
  getAnalysis(): LoadResult {
    return this.require().analysisJson;
  }

  getObjectDetail(objectId: ObjectId): PdfObjectDetail {
    const s = this.require();
    const summary = s.analysisJson.analysis.objectsIndex[objectId];
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
    const obj = s.objects.get(objectId);
    if (!obj) throw new Error(`Object not found: ${objectId}`);
    if (obj.value.kind !== "stream") {
      throw new Error(`Object ${objectId} is not a stream`);
    }
    if (!obj.range || obj.value.kind !== "stream") {
      throw new Error(`Object ${objectId} has no stream range`);
    }
    // Compressed objects share the parent stream's range — abort cleanly.
    if (!objectHasStreamPosition(obj, s.bytes)) {
      throw new Error(`Object ${objectId} is compressed; access via its parent stream`);
    }

    const handle = obj.value.handle;
    const raw = s.bytes.subarray(
      streamRangeStart(obj, s.bytes),
      streamRangeStart(obj, s.bytes) + handle.length,
    );
    if (mode === "raw") {
      const copy = raw.slice();
      return {
        bytes: copy.buffer,
        decoded: false,
        truncated: false,
      };
    }
    const decoded = await this.decodeCached(objectId, raw, handle.filters, obj.value.dict);
    const transfer = decoded.slice();
    return {
      bytes: transfer.buffer,
      decoded: true,
      truncated: false,
    };
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
    const page = s.analysisJson.analysis.pages[pageNumber - 1];
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
      if (obj.value.kind !== "stream") {
        allWarnings.push({
          id: `warn:contents-not-stream:${ref}`,
          severity: "warn",
          category: "structure",
          message: `Content object ${ref} is not a stream`,
        });
        continue;
      }
      const dict = obj.value.dict;
      const start = streamRangeStart(obj, s.bytes);
      const raw = s.bytes.subarray(start, start + obj.value.handle.length);
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
    const combined = concatBytes(allBytes);
    const { operations, warnings } = parseContentStream(combined, pageNumber);

    // Resolve the page's resources (using inherited if needed — manifest already
    // resolved page.resourceRef to either the page's own or an inherited ref).
    const resources = resolveResources({
      pageNumber,
      resourceRef: page.resourceRef,
      objects: s.objects,
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

    return {
      pageNumber,
      operations,
      resources,
      visualElements,
      warnings: [...allWarnings, ...warnings, ...vwarnings],
    };
  }

  private async decodeStreamObject(objectId: string): Promise<Uint8Array | null> {
    const s = this.require();
    const obj = s.objects.get(objectId);
    if (!obj || obj.value.kind !== "stream") return null;
    const dict = obj.value.dict;
    const start = streamRangeStart(obj, s.bytes);
    const raw = s.bytes.subarray(start, start + obj.value.handle.length);
    return this.decodeCached(objectId, raw, extractFilters(dict), dict);
  }

  private require(): State {
    if (!this.state) throw new Error("No PDF loaded");
    return this.state;
  }
}

// =============================================================================
// Helpers
// =============================================================================

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

function objectHasStreamPosition(obj: IndirectObject, _bytes: Uint8Array): boolean {
  // A compressed object lives inside another stream and has no usable
  // file offset of its own. Identify it by checking whether the indirect
  // header sits at obj.range.start in the file.
  return obj.range.end > obj.range.start;
}

function streamRangeStart(obj: IndirectObject, bytes: Uint8Array): number {
  // The handle stores length only, not the byte offset. For now, scan
  // forward from the obj header for the "stream" keyword and skip its
  // newline. We rely on the fact that buildManifest already parsed the
  // object so the structure is well-formed.
  const start = obj.range.start;
  const slice = bytes.subarray(start, obj.range.end);
  const i = indexOfSubsequence(slice, [0x73, 0x74, 0x72, 0x65, 0x61, 0x6d]); // "stream"
  if (i === -1) throw new Error("stream keyword not located");
  let pos = i + 6;
  if (slice[pos] === 0x0d && slice[pos + 1] === 0x0a) pos += 2;
  else if (slice[pos] === 0x0a) pos += 1;
  return start + pos;
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

function indexOfSubsequence(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
