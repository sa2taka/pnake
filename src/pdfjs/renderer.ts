/**
 * Thin wrapper around PDF.js — pnake uses it for canvas rendering
 * only; the lossless inspection is done by our own parser.
 *
 * PDF.js is dynamically imported so the bundle splits cleanly and so
 * the worker file URL is resolved through Vite's worker plugin.
 *
 * Lifecycle invariants:
 *   - The document cache key is content-derived (byteLength + a short
 *     SHA-256 prefix), not the ArrayBuffer identity. A buffer that has
 *     been transferred / sliced still hits the cache for the same file.
 *   - Switching documents awaits the previous destroy() before the new
 *     getDocument resolves, so the old worker tasks are fully released.
 *   - Each render returns a handle whose `cancel()` aborts the in-flight
 *     PDF.js render task. The caller (RenderPanel) calls it on cleanup
 *     so rapid page changes don't paint stale frames.
 */

import type {
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist/types/src/display/api";

let workerConfigured = false;

async function ensureWorker(): Promise<void> {
  if (workerConfigured) return;
  const lib = await import("pdfjs-dist");
  const workerUrl = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  );
  lib.GlobalWorkerOptions.workerSrc = workerUrl.toString();
  workerConfigured = true;
}

interface CachedDoc {
  fingerprint: string;
  doc: PDFDocumentProxy;
}
let cached: CachedDoc | null = null;
let cacheReplaceInFlight: Promise<void> = Promise.resolve();

export interface RenderPageInput {
  bytes: ArrayBuffer;
  pageNumber: number;
  canvas: HTMLCanvasElement;
  scale?: number;
}

export interface RenderResult {
  width: number;
  height: number;
}

/**
 * Render returns an object that lets the caller cancel before the
 * promise resolves. RenderPanel's effect cleanup uses this to abort
 * stale renders when the page changes mid-paint.
 */
export interface RenderHandle {
  result: Promise<RenderResult>;
  cancel(): void;
}

export function renderPageWithHandle(input: RenderPageInput): RenderHandle {
  let renderTask: RenderTask | null = null;
  let cancelled = false;

  const result = (async (): Promise<RenderResult> => {
    await ensureWorker();
    const lib = await import("pdfjs-dist");
    const doc = await loadDocument(lib, input.bytes);
    if (cancelled) throw new DOMException("Render cancelled", "AbortError");
    const page: PDFPageProxy = await doc.getPage(input.pageNumber);
    if (cancelled) throw new DOMException("Render cancelled", "AbortError");

    const scale = input.scale ?? 1;
    const viewport = page.getViewport({ scale });
    const canvas = input.canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    renderTask = page.render({ canvasContext: ctx, viewport, canvas } as never);
    await renderTask.promise;
    return { width: canvas.width, height: canvas.height };
  })();

  return {
    result,
    cancel() {
      cancelled = true;
      renderTask?.cancel();
    },
  };
}

/**
 * Convenience wrapper for callers that don't need cancellation —
 * preserved so existing tests keep working. New code should prefer
 * renderPageWithHandle.
 */
export async function renderPage(input: RenderPageInput): Promise<RenderResult> {
  return renderPageWithHandle(input).result;
}

async function loadDocument(
  lib: typeof import("pdfjs-dist"),
  bytes: ArrayBuffer,
): Promise<PDFDocumentProxy> {
  const fingerprint = await contentFingerprint(bytes);
  // Wait for any pending destroy() so we don't race with eviction.
  await cacheReplaceInFlight;
  if (cached && cached.fingerprint === fingerprint) return cached.doc;
  if (cached) {
    const previous = cached;
    cached = null;
    // Detach the destroy promise to the shared barrier; the next call
    // can await it without blocking the current load.
    cacheReplaceInFlight = previous.doc.destroy().catch(() => undefined);
    await cacheReplaceInFlight;
  }
  const task = lib.getDocument({ data: bytes.slice(0) });
  const doc = await task.promise;
  cached = { fingerprint, doc };
  return doc;
}

/**
 * Hash a few well-spaced regions of the buffer rather than the entire
 * thing — sub-second for 100MB PDFs and stable across slice() / transfer.
 */
async function contentFingerprint(bytes: ArrayBuffer): Promise<string> {
  const view = new Uint8Array(bytes);
  const len = view.byteLength;
  const sample = pickSample(view, len);
  // Crypto's BufferSource overload is invariant in ArrayBuffer vs
  // SharedArrayBuffer; copy into a plain ArrayBuffer to satisfy it.
  const digest = await crypto.subtle.digest("SHA-256", sample.slice().buffer);
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${len}:${hex}`;
}

function pickSample(view: Uint8Array, len: number): Uint8Array {
  // For tiny buffers (under 4 KiB) hash the whole thing.
  if (len <= 4096) return view;
  const slice = (start: number, n: number) => view.subarray(start, Math.min(start + n, len));
  // Three 1 KiB slices: beginning, middle, end. With the trailing /
  // %%EOF area in the third slice we catch revision changes too.
  const head = slice(0, 1024);
  const mid = slice(Math.floor(len / 2) - 512, 1024);
  const tail = slice(len - 1024, 1024);
  const out = new Uint8Array(head.length + mid.length + tail.length);
  out.set(head, 0);
  out.set(mid, head.length);
  out.set(tail, head.length + mid.length);
  return out;
}
