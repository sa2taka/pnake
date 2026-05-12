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

/**
 * Every variant optionally carries the byte range of the source
 * tokens that produced it. The parser populates this; manually
 * constructed values (in tests and the explanation layer) may omit
 * it. Consumers that need provenance check `value.range`; consumers
 * that don't care continue to ignore it.
 */
export type PdfValue =
  | { kind: "null"; range?: ByteRange }
  | { kind: "bool"; value: boolean; range?: ByteRange }
  | { kind: "int"; value: number; range?: ByteRange }
  | { kind: "real"; value: number; range?: ByteRange }
  | { kind: "name"; value: string; range?: ByteRange }
  | { kind: "string"; raw: Uint8Array; text?: string; hex?: boolean; range?: ByteRange }
  | { kind: "array"; items: PdfValue[]; range?: ByteRange }
  | { kind: "dict"; entries: PdfDict; range?: ByteRange }
  | { kind: "ref"; target: ObjectId; range?: ByteRange }
  | { kind: "stream"; dict: PdfDict; handle: StreamHandle; range?: ByteRange };

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
  formFields: number;
  embeddedFiles: number;
  hasJavaScript: boolean;
}

export type PdfFormFieldType = "Tx" | "Btn" | "Ch" | "Sig" | "Unknown";

export interface PdfFormField {
  objectRef: ObjectId;
  name: string;
  fullName: string;
  fieldType: PdfFormFieldType;
  value?: string;
  signed: boolean;
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
// Resources
// =============================================================================

export interface PdfFontResource {
  objectRef: ObjectId;
  name: string;
  subtype: "Type0" | "Type1" | "Type3" | "MMType1" | "TrueType" | "CIDFontType0" | "CIDFontType2" | "Unknown";
  baseFont?: string;
  encoding?: string;
  toUnicodeRef?: ObjectId;
  embedded: boolean;
}

export interface PdfXObjectResource {
  objectRef: ObjectId;
  name: string;
  subtype: "Image" | "Form" | "PS" | "Unknown";
  width?: number;
  height?: number;
  colorSpace?: string;
  bitsPerComponent?: number;
  filters: PdfFilter[];
}

export interface PdfResolvedResources {
  pageNumber: number;
  fonts: Record<string, PdfFontResource>;
  xobjects: Record<string, PdfXObjectResource>;
  extGStates: Record<string, ObjectId>;
  colorSpaces: Record<string, ObjectId>;
  patterns: Record<string, ObjectId>;
  shadings: Record<string, ObjectId>;
  procSets: string[];
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
  /** Currently-active /MCID from the enclosing BDC marked-content block. */
  mcid?: number;
}

// =============================================================================
// Logical structure (tagged PDF)
// =============================================================================

export interface PdfStructTreeNode {
  id: string;
  objectRef?: ObjectId;
  structureType: string;
  title?: string;
  alt?: string;
  lang?: string;
  actualText?: string;
  children: PdfStructTreeChild[];
}

export type PdfStructTreeChild =
  | { kind: "elem"; node: PdfStructTreeNode }
  | { kind: "mcid"; mcid: number; page?: ObjectId }
  | { kind: "objr"; ref: ObjectId; page?: ObjectId };

export interface PdfStructTree {
  root: PdfStructTreeNode;
}

// =============================================================================
// Visual elements (overlay-bound)
// =============================================================================

export interface PdfVisualElement {
  id: string;
  kind: "text-run" | "image" | "path" | "form-xobject" | "annotation" | "clip";
  bbox: PdfRect;
  zIndex: number;
  sourceOperationIds: string[];
  preview?: string;
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
  formFields: PdfFormField[];
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
