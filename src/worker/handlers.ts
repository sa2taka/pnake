/**
 * Worker-side state and handlers.
 *
 * Exposed as a class so we can construct it in tests without spinning
 * up a real worker thread.
 */

import type {
  ObjectId,
  PdfObjectDetail,
  PdfValue,
} from "../shared/ir-types";
import type { LoadResult, PageOperationsResult, StreamResult } from "../shared/protocol";
import { ByteReader, asciiString } from "./pdf/io/byte-reader";
import type { IndirectObject } from "./pdf/parse/object-reader";
import { decodeStream, extractDecodeParms } from "./pdf/streams/decode";
import { parsePdf } from "./pdf/structure/manifest";

interface State {
  bytes: Uint8Array;
  reader: ByteReader;
  objects: Map<ObjectId, IndirectObject>;
  analysisJson: LoadResult;
}

export class ParserState {
  private state?: State;

  async load(buffer: ArrayBuffer): Promise<LoadResult> {
    const bytes = new Uint8Array(buffer);
    const { analysis, objects, reader } = await parsePdf(bytes);
    this.state = {
      bytes,
      reader,
      objects,
      analysisJson: { analysis },
    };
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
    const copy = raw.slice();
    if (mode === "raw") {
      return {
        bytes: copy.buffer,
        decoded: false,
        truncated: false,
      };
    }
    const decoded = await decodeStream(
      raw,
      handle.filters,
      extractDecodeParms(obj.value.dict),
    );
    return {
      bytes: (decoded.buffer as ArrayBuffer).slice(
        decoded.byteOffset,
        decoded.byteOffset + decoded.byteLength,
      ),
      decoded: true,
      truncated: false,
    };
  }

  // Placeholder — fully implemented in Phase 2.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getPageOperations(_pageNumber: number): PageOperationsResult {
    throw new Error("getPageOperations is not implemented yet");
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

function indexOfSubsequence(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
