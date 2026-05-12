/**
 * IR types — the single source of truth on the TypeScript side.
 * Must stay in sync with docs/DATA_MODEL.md (see ADR-006).
 */

export type ObjectId = string;

export interface ByteRange {
  start: number;
  end: number;
}

export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Matrix = [number, number, number, number, number, number];

// =============================================================================
// Value graph (COS objects)
// =============================================================================

export type PdfFilter =
  | "FlateDecode"
  | "DCTDecode"
  | "JPXDecode"
  | "CCITTFaxDecode"
  | "LZWDecode"
  | "ASCII85Decode"
  | "ASCIIHexDecode"
  | "RunLengthDecode"
  | "JBIG2Decode"
  | "Crypt"
  | { kind: "unknown"; name: string };

export interface StreamHandle {
  objectRef: ObjectId;
  filters: PdfFilter[];
  length: number;
  decodedLength?: number;
}

export type PdfValue =
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "int"; value: number }
  | { kind: "real"; value: number }
  | { kind: "name"; value: string }
  | { kind: "string"; raw: Uint8Array; text?: string; hex?: boolean }
  | { kind: "array"; items: PdfValue[] }
  | { kind: "dict"; entries: PdfDict }
  | { kind: "ref"; target: ObjectId }
  | { kind: "stream"; dict: PdfDict; handle: StreamHandle };

export type PdfDict = Record<string, PdfValue>;

// =============================================================================
// File structure
// =============================================================================

export interface PdfFileInfo {
  byteSize: number;
  sha256?: string;
  pdfVersion: string;
  encrypted: boolean;
  linearized: boolean;
  incrementalUpdates: number;
  tagged: boolean;
  acroForm: boolean;
  xfa: boolean;
  signatures: number;
  embeddedFiles: number;
  hasJavaScript: boolean;
}

export interface PdfXrefEntry {
  objectNumber: number;
  generation: number;
  type: "n" | "f" | "compressed";
  offset?: number;
  compressedIn?: ObjectId;
  indexInStream?: number;
}

export type PdfXref =
  | { kind: "table"; range: ByteRange; entries: PdfXrefEntry[] }
  | { kind: "stream"; range: ByteRange; objectRef: ObjectId; entries: PdfXrefEntry[] };

export interface PdfTrailer {
  range: ByteRange;
  dict: PdfDict;
}

export interface PdfBody {
  index: number;
  range: ByteRange;
  xref: PdfXref;
  trailer: PdfTrailer;
  startxrefOffset: number;
}

export interface PdfFileStructure {
  header: { range: ByteRange; raw: string };
  bodies: PdfBody[];
  eofMarkers: ByteRange[];
}

// =============================================================================
// Object graph
// =============================================================================

export type PdfObjectKind =
  | "catalog"
  | "pages"
  | "page"
  | "resources"
  | "font"
  | "fontDescriptor"
  | "encoding"
  | "xobjectImage"
  | "xobjectForm"
  | "extGState"
  | "colorSpace"
  | "pattern"
  | "shading"
  | "annot"
  | "structTreeRoot"
  | "structElem"
  | "metadata"
  | "embeddedFile"
  | "outlines"
  | "acroForm"
  | "signature"
  | "contentStream"
  | "objectStream"
  | "xrefStream"
  | "other";

export interface PdfObjectSummary {
  id: ObjectId;
  number: number;
  generation: number;
  byteRange: ByteRange;
  type: PdfObjectKind;
  hint?: string;
  inObjectStream?: ObjectId;
  hasStream: boolean;
}

export interface PdfObjectDetail extends PdfObjectSummary {
  value: PdfValue;
  rawText: string;
}

// =============================================================================
// Document graph
// =============================================================================

export interface PdfDocumentTree {
  catalogRef: ObjectId;
  metadata?: ObjectId;
  info?: ObjectId;
  pagesRootRef: ObjectId;
  outlinesRef?: ObjectId;
  acroFormRef?: ObjectId;
  structTreeRootRef?: ObjectId;
  namesRef?: ObjectId;
  embeddedFiles?: { name: string; objectRef: ObjectId }[];
}

// =============================================================================
// Pages
// =============================================================================

export interface PdfPageBoxes {
  mediaBox: PdfRect;
  cropBox?: PdfRect;
  bleedBox?: PdfRect;
  trimBox?: PdfRect;
  artBox?: PdfRect;
}

export interface PdfPageSummary {
  pageNumber: number;
  objectRef: ObjectId;
  boxes: PdfPageBoxes;
  rotation: 0 | 90 | 180 | 270;
  userUnit: number;
  resourceRef?: ObjectId;
  contentStreamRefs: ObjectId[];
  annotationRefs: ObjectId[];
}

// =============================================================================
// Content stream operations
// =============================================================================

export type PdfOpCategory =
  | "graphics-state"
  | "path-construct"
  | "path-paint"
  | "clipping"
  | "text-object"
  | "text-state"
  | "text-positioning"
  | "text-show"
  | "color"
  | "xobject"
  | "image-inline"
  | "shading"
  | "marked-content"
  | "compatibility"
  | "type3-font"
  | "unknown";

export interface PdfOperation {
  id: string;
  sequence: number;
  operator: string;
  operands: PdfValue[];
  category: PdfOpCategory;
  rawRange?: ByteRange;
  decodedRange?: ByteRange;
  resourceRefs?: ObjectId[];
}

// =============================================================================
// Warnings
// =============================================================================

export interface PdfWarning {
  id: string;
  severity: "info" | "warn" | "error";
  category:
    | "structure"
    | "xref"
    | "stream"
    | "filter"
    | "font"
    | "encoding"
    | "color"
    | "security"
    | "performance"
    | "unsupported";
  message: string;
  hint?: string;
  byteRange?: ByteRange;
  relatedNodeIds?: string[];
}

// =============================================================================
// Top-level analysis manifest
// =============================================================================

export interface PdfAnalysis {
  fileInfo: PdfFileInfo;
  fileStructure: PdfFileStructure;
  objectsIndex: Record<ObjectId, PdfObjectSummary>;
  documentTree?: PdfDocumentTree;
  pages: PdfPageSummary[];
  warnings: PdfWarning[];
}

// =============================================================================
// ID helpers
// =============================================================================

export function objectId(num: number, gen: number): ObjectId {
  return `obj:${num}:${gen}`;
}

export function parseObjectId(id: ObjectId): { number: number; generation: number } | null {
  const m = /^obj:(\d+):(\d+)$/.exec(id);
  if (!m) return null;
  return { number: Number(m[1]), generation: Number(m[2]) };
}

export function pageId(pageNumber: number): string {
  return `page:${pageNumber}`;
}

export function operationId(pageNumber: number, sequence: number): string {
  return `page:${pageNumber}:op:${sequence}`;
}
