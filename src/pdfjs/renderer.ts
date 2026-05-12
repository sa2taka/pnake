/**
 * Thin wrapper around PDF.js — pnake uses it for canvas rendering
 * only; the lossless inspection is done by our own parser.
 *
 * PDF.js is dynamically imported so the bundle splits cleanly and so
 * the worker file URL is resolved through Vite's worker plugin.
 */

import type {
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/types/src/display/api";

let workerConfigured = false;

async function ensureWorker(): Promise<void> {
  if (workerConfigured) return;
  const lib = await import("pdfjs-dist");
  // The worker is shipped as a side bundle in pdfjs-dist.
  // Using new URL(...) ensures Vite bundles the right path.
  const workerUrl = new URL(
    // PDF.js v4+ ships the worker as an ES module.
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  );
  lib.GlobalWorkerOptions.workerSrc = workerUrl.toString();
  workerConfigured = true;
}

let cached: { fingerprint: ArrayBuffer; doc: PDFDocumentProxy } | null = null;

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

export async function renderPage(input: RenderPageInput): Promise<RenderResult> {
  await ensureWorker();
  const lib = await import("pdfjs-dist");
  const doc = await loadDocument(lib, input.bytes);
  const page: PDFPageProxy = await doc.getPage(input.pageNumber);
  const scale = input.scale ?? 1;
  const viewport = page.getViewport({ scale });
  const canvas = input.canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  // Resize the canvas backing store; CSS size stays driven by layout.
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
  return { width: canvas.width, height: canvas.height };
}

async function loadDocument(
  lib: typeof import("pdfjs-dist"),
  bytes: ArrayBuffer,
): Promise<PDFDocumentProxy> {
  // Cheap identity check: same ArrayBuffer reference + length keeps us
  // from reloading on each page navigation.
  if (cached && cached.fingerprint === bytes) return cached.doc;
  if (cached) {
    void cached.doc.destroy();
    cached = null;
  }
  const task = lib.getDocument({ data: bytes.slice(0) });
  const doc = await task.promise;
  cached = { fingerprint: bytes, doc };
  return doc;
}
