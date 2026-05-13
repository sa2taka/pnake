/**
 * Build a PdfAnalysis manifest from raw bytes.
 *
 * Pipeline:
 *   1. parseStructure     — header, EOF markers, xref chain, recovery
 *   2. loadObjectGraph    — in-use objects + ObjStm expansion + summaries
 *   3. buildDocumentGraph — catalog, page tree, AcroForm field tree
 *   4. collectFileInfo    — encrypted / linearized / tagged / xfa / js flags
 *
 * Each phase returns an intermediate result; the orchestrator at the
 * bottom just composes them and merges the per-phase warnings into the
 * analysis. Stream bodies are NOT decoded here — the manifest stays
 * lightweight so the UI can render the object tree immediately while
 * details are pulled lazily.
 */

import type {
  ByteRange,
  ObjectId,
  PdfAnalysis,
  PdfBody,
  PdfDict,
  PdfDocumentTree,
  PdfFileInfo,
  PdfFormField,
  PdfFormFieldType,
  PdfObjectKind,
  PdfObjectSummary,
  PdfPageSummary,
  PdfRect,
  PdfTrailer,
  PdfValue,
  PdfWarning,
  PdfXref,
  PdfXrefEntry,
} from "../../../shared/ir-types";
import { parseObjectId } from "../../../shared/ir-types";
import { ByteReader, asciiString, isWhitespace, toBytes } from "../io/byte-reader";
import { IndirectObjectReader, type IndirectObject } from "../parse/object-reader";
import { expectArray, expectInt, expectName, expectRef } from "../parse/value-parser";
import {
  findEofMarkers,
  findStartxref,
  parseXrefAndTrailer,
  KW_XREF,
} from "./xref-table";
import { parseXrefStream } from "./xref-stream";
import { parseObjectStream } from "./object-stream";
import { scanIndirectObjectHeaders } from "./scan-recovery";

const HEADER_SIG = toBytes("%PDF-");

export interface ParseResult {
  analysis: PdfAnalysis;
  objects: Map<ObjectId, IndirectObject>;
  reader: ByteReader;
}

// =============================================================================
// Phase result shapes (intermediate, not part of the public IR)
// =============================================================================

interface HeaderInfo {
  version: string;
  range: ByteRange;
  raw: string;
}

interface StructureParse {
  header: HeaderInfo;
  eofMarkers: ByteRange[];
  bodies: PdfBody[];
  xrefEntries: Map<number, PdfXrefEntry>;
  /**
   * Structured signal for what recovery, if any, was needed.
   *  - "none":         clean xref walk
   *  - "no-startxref": startxref missing entirely; scan-recovered
   *  - "empty-xref":   xref walked but produced 0 entries; scan-recovered
   *  - "partial-scan": at least one /Prev hop failed mid-walk; scan filled the gap
   */
  recovery: "none" | "no-startxref" | "empty-xref" | "partial-scan";
  warnings: PdfWarning[];
}

interface ObjectGraph {
  objects: Map<ObjectId, IndirectObject>;
  objectsIndex: Record<ObjectId, PdfObjectSummary>;
  warnings: PdfWarning[];
}

interface DocumentGraph {
  tree?: PdfDocumentTree;
  pages: PdfPageSummary[];
  formFields: PdfFormField[];
  warnings: PdfWarning[];
}

// =============================================================================
// Orchestrator
// =============================================================================

export async function buildManifest(bytes: Uint8Array): Promise<PdfAnalysis> {
  return (await parsePdf(bytes)).analysis;
}

export async function parsePdf(bytes: Uint8Array): Promise<ParseResult> {
  const reader = new ByteReader(bytes);
  const structure = await parseStructure(reader);
  const graph = await loadObjectGraph(reader, structure);
  const documents = buildDocumentGraph(graph.objects, structure);
  const fileInfo = collectFileInfo(reader, bytes, structure, documents, graph.objects);

  const analysis: PdfAnalysis = {
    fileInfo,
    fileStructure: {
      header: { range: structure.header.range, raw: structure.header.raw },
      bodies: structure.bodies,
      eofMarkers: structure.eofMarkers,
    },
    objectsIndex: graph.objectsIndex,
    ...(documents.tree ? { documentTree: documents.tree } : {}),
    pages: documents.pages,
    formFields: documents.formFields,
    warnings: [...structure.warnings, ...graph.warnings, ...documents.warnings],
  };
  return { analysis, objects: graph.objects, reader };
}

// =============================================================================
// Phase 1 — Structure: header / EOF / xref chain
// =============================================================================

async function parseStructure(reader: ByteReader): Promise<StructureParse> {
  const warnings: PdfWarning[] = [];
  const header = readHeader(reader, warnings);
  const eofMarkers = findEofMarkers(reader);
  const startxrefOffset = findStartxref(reader);

  const bodies: PdfBody[] = [];
  const xrefEntries = new Map<number, PdfXrefEntry>();
  let recovery: StructureParse["recovery"] = "none";

  if (startxrefOffset == null) {
    warnings.push({
      id: "warn:startxref-missing",
      severity: "warn",
      category: "structure",
      message:
        "Could not locate startxref — recovering by scanning for indirect object headers",
    });
    fillFromScan(reader, xrefEntries);
    recovery = "no-startxref";
  } else {
    const chain = await walkXrefChain(reader, startxrefOffset);
    bodies.push(...chain.bodies);
    for (const [num, entry] of chain.entries) xrefEntries.set(num, entry);
    warnings.push(...chain.warnings);

    if (xrefEntries.size === 0) {
      warnings.push({
        id: "warn:xref-empty",
        severity: "warn",
        category: "xref",
        message: "xref chain produced no usable entries; falling back to a linear scan",
      });
      fillFromScan(reader, xrefEntries);
      recovery = "empty-xref";
    } else if (chain.hadFailedHop) {
      // Some legitimate older-revision objects may be missing. A linear scan
      // fills them in WITHOUT overwriting newer xref entries (fillFromScan
      // respects existing keys), so the newest revision still wins.
      warnings.push({
        id: "warn:xref-partial-recovery",
        severity: "info",
        category: "xref",
        message:
          "An xref hop failed; recovering missing objects from a linear scan of indirect headers",
      });
      fillFromScan(reader, xrefEntries);
      recovery = "partial-scan";
    }
  }

  return { header, eofMarkers, bodies, xrefEntries, recovery, warnings };
}

function readHeader(reader: ByteReader, warnings: PdfWarning[]): HeaderInfo {
  // Scan the first 1024 bytes for the signature; some files prefix junk.
  const scanEnd = Math.min(1024, reader.end);
  const sigIdx = reader.indexOf(HEADER_SIG, 0, scanEnd);
  if (sigIdx === -1) {
    warnings.push({
      id: "warn:header-missing",
      severity: "error",
      category: "structure",
      message: "PDF header (%PDF-) not found in first 1KiB",
    });
    return { version: "unknown", range: { start: 0, end: 0 }, raw: "" };
  }
  reader.seek(sigIdx);
  reader.advance(HEADER_SIG.length);
  const verStart = reader.pos;
  reader.skipWhile((b) => b !== 0x0a && b !== 0x0d);
  const verEnd = reader.pos;
  const version = asciiString(reader.subview(verStart, verEnd)).trim();
  return { version, range: { start: sigIdx, end: verEnd }, raw: `%PDF-${version}` };
}

function fillFromScan(reader: ByteReader, entries: Map<number, PdfXrefEntry>): void {
  const scanned = scanIndirectObjectHeaders(reader);
  for (const entry of scanned) {
    if (!entries.has(entry.objectNumber)) {
      entries.set(entry.objectNumber, entry);
    }
  }
}

interface XrefChainResult {
  bodies: PdfBody[];
  entries: Map<number, PdfXrefEntry>;
  hadFailedHop: boolean;
  warnings: PdfWarning[];
}

async function walkXrefChain(
  reader: ByteReader,
  startOffset: number,
): Promise<XrefChainResult> {
  const bodies: PdfBody[] = [];
  const entries = new Map<number, PdfXrefEntry>();
  const warnings: PdfWarning[] = [];
  const visited = new Set<number>();
  let hadFailedHop = false;
  let offset: number | null = startOffset;

  while (offset != null && !visited.has(offset)) {
    const currentOffset = offset;
    visited.add(currentOffset);
    try {
      const parsed = await readXrefAt(reader, currentOffset);
      const body: PdfBody = {
        index: bodies.length,
        range: { start: 0, end: 0 }, // approximate; not load-bearing for Phase 1
        xref: parsed.xref,
        trailer: parsed.trailer,
        startxrefOffset: currentOffset,
      };
      bodies.unshift(body); // oldest first
      for (const entry of parsed.xref.entries) {
        if (!entries.has(entry.objectNumber)) entries.set(entry.objectNumber, entry);
      }
      warnings.push(...parsed.warnings);

      // Hybrid-reference files: the classic trailer may also point to a
      // supplementary cross-reference stream via /XRefStm. Per ISO 32000-2
      // §7.5.8.4, that stream provides additional entries for the same body.
      // Visit it before /Prev so its entries take effect at the same revision.
      const xrefStmOffset = readXRefStm(parsed.trailer.dict);
      if (xrefStmOffset != null && !visited.has(xrefStmOffset)) {
        visited.add(xrefStmOffset);
        try {
          const supplementary = await readXrefAt(reader, xrefStmOffset);
          for (const entry of supplementary.xref.entries) {
            if (!entries.has(entry.objectNumber)) entries.set(entry.objectNumber, entry);
          }
          warnings.push(...supplementary.warnings);
        } catch (err) {
          warnings.push({
            id: `warn:xrefstm-failed:${xrefStmOffset.toString(16)}`,
            severity: "warn",
            category: "xref",
            message: `Failed to parse /XRefStm at offset ${xrefStmOffset}: ${(err as Error).message}`,
          });
        }
      }

      offset = readPrev(parsed.trailer.dict);
    } catch (err) {
      hadFailedHop = true;
      warnings.push({
        id: `warn:xref-failed:${currentOffset.toString(16)}`,
        severity: "error",
        category: "xref",
        message: `Failed to parse xref at offset ${currentOffset}: ${(err as Error).message}`,
      });
      offset = null;
    }
  }
  return { bodies, entries, hadFailedHop, warnings };
}

interface XrefParse {
  xref: PdfXref;
  trailer: PdfTrailer;
  warnings: PdfWarning[];
}

async function readXrefAt(reader: ByteReader, offset: number): Promise<XrefParse> {
  // Classic xref tables start with the keyword "xref". Anything else we
  // attempt to parse as a cross-reference stream object.
  reader.seek(offset);
  reader.skipWhile(isWhitespace);
  if (reader.startsWith(KW_XREF)) {
    return parseXrefAndTrailer(reader, reader.pos);
  }
  return parseXrefStream(reader, reader.pos);
}

function readPrev(dict: PdfDict): number | null {
  return expectInt(dict["Prev"]) ?? null;
}

function readXRefStm(dict: PdfDict): number | null {
  return expectInt(dict["XRefStm"]) ?? null;
}

// =============================================================================
// Phase 2 — Object graph: read indirect objects + expand ObjStm + summarise
// =============================================================================

async function loadObjectGraph(
  reader: ByteReader,
  structure: StructureParse,
): Promise<ObjectGraph> {
  const warnings: PdfWarning[] = [];
  const objects = await loadObjects(reader, structure.xrefEntries, warnings);
  const objectsIndex: Record<ObjectId, PdfObjectSummary> = {};
  for (const obj of objects.values()) {
    const summary = summarize(obj);
    objectsIndex[summary.id] = summary;
  }
  return { objects, objectsIndex, warnings };
}

async function loadObjects(
  reader: ByteReader,
  entries: Map<number, PdfXrefEntry>,
  warnings: PdfWarning[],
): Promise<Map<ObjectId, IndirectObject>> {
  const objects = new Map<ObjectId, IndirectObject>();
  const objectReader = new IndirectObjectReader(reader);

  // First pass: direct file-offset objects.
  const compressed: PdfXrefEntry[] = [];
  for (const entry of entries.values()) {
    if (entry.type === "n" && entry.offset != null) {
      try {
        const obj = objectReader.readAt(entry.offset);
        objects.set(obj.id, obj);
        if (obj.warnings) warnings.push(...obj.warnings);
      } catch (err) {
        warnings.push({
          id: `warn:object-parse:${entry.objectNumber}:${entry.generation}`,
          severity: "warn",
          category: "structure",
          message: `Failed to read object ${entry.objectNumber} ${entry.generation}: ${(err as Error).message}`,
        });
      }
      continue;
    }
    if (entry.type === "compressed") compressed.push(entry);
  }

  // Second pass: decompress object streams referenced by compressed entries.
  // Only emit objects that the xref explicitly claims as compressed-in — an
  // ObjStm can carry stale or shadowed objects whose latest revision lives
  // elsewhere, and we must not resurrect them silently.
  const allowedByParent = new Map<ObjectId, Set<number>>();
  for (const entry of compressed) {
    if (!entry.compressedIn) continue;
    let set = allowedByParent.get(entry.compressedIn);
    if (!set) {
      set = new Set<number>();
      allowedByParent.set(entry.compressedIn, set);
    }
    set.add(entry.objectNumber);
  }
  for (const [parentId, allowed] of allowedByParent) {
    const parent = objects.get(parentId);
    if (!parent) {
      warnings.push({
        id: `warn:objstm-missing:${parentId}`,
        severity: "warn",
        category: "structure",
        message: `Compressed entries refer to missing object stream ${parentId}`,
      });
      continue;
    }
    try {
      const contents = await parseObjectStream(reader, parent);
      let resurrected = 0;
      for (const entry of contents.entries) {
        if (!allowed.has(entry.number)) {
          resurrected++;
          continue;
        }
        objects.set(entry.id, {
          id: entry.id,
          number: entry.number,
          generation: 0,
          range: parent.range,
          value: entry.value,
        });
      }
      if (resurrected > 0) {
        warnings.push({
          id: `warn:objstm-skipped:${parentId}`,
          severity: "info",
          category: "structure",
          message: `Skipped ${resurrected} non-xref objects inside ${parentId}`,
        });
      }
    } catch (err) {
      warnings.push({
        id: `warn:objstm-parse:${parentId}`,
        severity: "warn",
        category: "structure",
        message: `Failed to expand object stream ${parentId}: ${(err as Error).message}`,
      });
    }
  }

  return objects;
}

function summarize(obj: IndirectObject): PdfObjectSummary {
  const kind = classify(obj);
  const hasStream = obj.value.kind === "stream";
  let hint: string | undefined;
  if (obj.value.kind === "dict" || obj.value.kind === "stream") {
    const dict = obj.value.kind === "dict" ? obj.value.entries : obj.value.dict;
    const typeName = expectName(dict.Type);
    const subtypeName = expectName(dict.Subtype);
    hint = subtypeName ? `${typeName ?? "Stream"} / ${subtypeName}` : typeName;
  }
  return {
    id: obj.id,
    number: obj.number,
    generation: obj.generation,
    byteRange: obj.range,
    type: kind,
    hint,
    hasStream,
  };
}

function classify(obj: IndirectObject): PdfObjectKind {
  if (obj.value.kind !== "dict" && obj.value.kind !== "stream") return "other";
  const dict = obj.value.kind === "dict" ? obj.value.entries : obj.value.dict;
  const typeName = expectName(dict.Type);
  const subtypeName = expectName(dict.Subtype);

  switch (typeName) {
    case "Catalog":
      return "catalog";
    case "Pages":
      return "pages";
    case "Page":
      return "page";
    case "Font":
      return "font";
    case "FontDescriptor":
      return "fontDescriptor";
    case "Encoding":
      return "encoding";
    case "ExtGState":
      return "extGState";
    case "Pattern":
      return "pattern";
    case "Shading":
      return "shading";
    case "Annot":
      return "annot";
    case "StructTreeRoot":
      return "structTreeRoot";
    case "StructElem":
      return "structElem";
    case "Metadata":
      return "metadata";
    case "EmbeddedFile":
      return "embeddedFile";
    case "Outlines":
      return "outlines";
    case "Filespec":
    case "Filespecifier":
      return "embeddedFile";
    case "XRef":
      return "xrefStream";
    case "ObjStm":
      return "objectStream";
    case "XObject":
      if (subtypeName === "Image") return "xobjectImage";
      if (subtypeName === "Form") return "xobjectForm";
      return "other";
    default:
      // Page-level /Contents streams have no /Type. Treat as content streams.
      if (obj.value.kind === "stream") return "contentStream";
      return "other";
  }
}

// =============================================================================
// Phase 3 — Document graph: catalog, page tree, AcroForm fields
// =============================================================================

function buildDocumentGraph(
  objects: Map<ObjectId, IndirectObject>,
  structure: StructureParse,
): DocumentGraph {
  const warnings: PdfWarning[] = [];
  const rootTrailerDict = structure.bodies[structure.bodies.length - 1]?.trailer.dict ?? {};
  const tree = resolveDocumentTree(rootTrailerDict, objects);
  const pages = enumeratePages(tree, objects, warnings);
  const formFields = enumerateFormFields(tree, objects);
  return { tree, pages, formFields, warnings };
}

function resolveDocumentTree(
  trailerDict: PdfDict,
  objects: Map<ObjectId, IndirectObject>,
): PdfDocumentTree | undefined {
  const rootRef = expectRef(trailerDict.Root);
  if (!rootRef) return undefined;
  const catalog = objects.get(rootRef);
  if (!catalog || catalog.value.kind !== "dict") {
    return { catalogRef: rootRef, pagesRootRef: rootRef };
  }
  const entries = catalog.value.entries;
  const pagesRootRef = expectRef(entries.Pages) ?? rootRef;
  const metadata = expectRef(entries.Metadata);
  const info = expectRef(trailerDict.Info);
  const outlinesRef = expectRef(entries.Outlines);
  const acroFormRef = expectRef(entries.AcroForm);
  const structTreeRootRef = expectRef(entries.StructTreeRoot);
  const namesRef = expectRef(entries.Names);

  const embeddedFiles = collectEmbeddedFiles(namesRef, objects);

  const tree: PdfDocumentTree = { catalogRef: rootRef, pagesRootRef };
  if (metadata) tree.metadata = metadata;
  if (info) tree.info = info;
  if (outlinesRef) tree.outlinesRef = outlinesRef;
  if (acroFormRef) tree.acroFormRef = acroFormRef;
  if (structTreeRootRef) tree.structTreeRootRef = structTreeRootRef;
  if (namesRef) tree.namesRef = namesRef;
  if (embeddedFiles.length > 0) tree.embeddedFiles = embeddedFiles;
  return tree;
}

function collectEmbeddedFiles(
  namesRef: ObjectId | undefined,
  objects: Map<ObjectId, IndirectObject>,
): { name: string; objectRef: ObjectId }[] {
  if (!namesRef) return [];
  const names = objects.get(namesRef);
  if (!names || names.value.kind !== "dict") return [];
  const ef = names.value.entries.EmbeddedFiles;
  if (!ef) return [];
  const efObj = ef.kind === "ref" ? objects.get(ef.target) : { value: ef };
  if (!efObj || efObj.value.kind !== "dict") return [];
  const namesArray = expectArray(efObj.value.entries.Names);
  if (!namesArray) return [];
  const out: { name: string; objectRef: ObjectId }[] = [];
  for (let i = 0; i + 1 < namesArray.length; i += 2) {
    const nameValue = namesArray[i];
    const refValue = namesArray[i + 1];
    if (!nameValue || !refValue) continue;
    const name = decodePdfString(nameValue);
    const ref = expectRef(refValue);
    if (name && ref) out.push({ name, objectRef: ref });
  }
  return out;
}

function decodePdfString(value: PdfValue): string | undefined {
  if (value.kind !== "string") return undefined;
  return asciiString(value.raw);
}

/**
 * Attributes that descend through the page tree (ISO 32000-2 §7.7.3.4).
 *
 * Inheritable: MediaBox, CropBox, Resources, Rotate. Other box types
 * (BleedBox, TrimBox, ArtBox) default to CropBox / MediaBox per spec,
 * but only if not explicitly set, which we model below.
 *
 * /Resources can be either an indirect reference (resourceRef) or an
 * inline dictionary (resourceDict). We track both so direct dicts on
 * ancestor /Pages nodes propagate to descendant /Page leaves.
 */
interface InheritedPageAttrs {
  mediaBox?: PdfRect;
  cropBox?: PdfRect;
  rotate?: number;
  resourceRef?: ObjectId;
  resourceDict?: PdfDict;
}

interface WalkPagesContext {
  objects: Map<ObjectId, IndirectObject>;
  pages: PdfPageSummary[];
  visited: Set<ObjectId>;
  warnings: PdfWarning[];
}

function enumeratePages(
  tree: PdfDocumentTree | undefined,
  objects: Map<ObjectId, IndirectObject>,
  warnings: PdfWarning[],
): PdfPageSummary[] {
  if (!tree) return [];
  const ctx: WalkPagesContext = {
    objects,
    pages: [],
    visited: new Set<ObjectId>(),
    warnings,
  };
  walkPages(tree.pagesRootRef, ctx, {});
  return ctx.pages;
}

function walkPages(
  ref: ObjectId,
  ctx: WalkPagesContext,
  inherited: InheritedPageAttrs,
): void {
  if (ctx.visited.has(ref)) return;
  ctx.visited.add(ref);
  const obj = ctx.objects.get(ref);
  if (!obj) {
    ctx.warnings.push({
      id: `warn:pages-missing:${ref}`,
      severity: "warn",
      category: "structure",
      message: `Page tree references missing object ${ref}`,
    });
    return;
  }
  const dict = obj.value.kind === "dict" ? obj.value.entries : undefined;
  if (!dict) return;
  const typeName = expectName(dict.Type);
  // Merge inheritable attributes from this node onto whatever we already have.
  const next = mergeInherited(inherited, dict);
  if (typeName === "Pages") {
    const kids = expectArray(dict.Kids) ?? [];
    for (const kid of kids) {
      const childRef = expectRef(kid);
      if (childRef) walkPages(childRef, ctx, next);
    }
    return;
  }
  if (typeName === "Page") {
    ctx.pages.push(buildPageSummary(ctx.pages.length + 1, ref, dict, next));
  }
}

function mergeInherited(parent: InheritedPageAttrs, dict: PdfDict): InheritedPageAttrs {
  const next: InheritedPageAttrs = { ...parent };
  const mediaBox = readRect(dict.MediaBox);
  if (mediaBox) next.mediaBox = mediaBox;
  const cropBox = readRect(dict.CropBox);
  if (cropBox) next.cropBox = cropBox;
  const rotate = expectInt(dict.Rotate);
  if (rotate != null) next.rotate = rotate;
  // /Resources can appear either indirectly (a ref to a separate object) or
  // directly (an inline dict on this very node). When a child overrides we
  // wipe both so the new form takes effect cleanly.
  const resources = dict.Resources;
  if (resources?.kind === "ref") {
    next.resourceRef = resources.target;
    delete next.resourceDict;
  } else if (resources?.kind === "dict") {
    next.resourceDict = resources.entries;
    delete next.resourceRef;
  }
  return next;
}

function buildPageSummary(
  pageNumber: number,
  ref: ObjectId,
  dict: PdfDict,
  inherited: InheritedPageAttrs,
): PdfPageSummary {
  const mediaBox =
    readRect(dict.MediaBox) ?? inherited.mediaBox ?? { x: 0, y: 0, w: 0, h: 0 };
  const summary: PdfPageSummary = {
    pageNumber,
    objectRef: ref,
    boxes: { mediaBox },
    rotation: normalizeRotation(expectInt(dict.Rotate) ?? inherited.rotate ?? 0),
    userUnit: 1,
    contentStreamRefs: refsFromValue(dict.Contents),
    annotationRefs: refsFromValue(dict.Annots),
  };
  const cropBox = readRect(dict.CropBox) ?? inherited.cropBox;
  const bleedBox = readRect(dict.BleedBox);
  const trimBox = readRect(dict.TrimBox);
  const artBox = readRect(dict.ArtBox);
  if (cropBox) summary.boxes.cropBox = cropBox;
  if (bleedBox) summary.boxes.bleedBox = bleedBox;
  if (trimBox) summary.boxes.trimBox = trimBox;
  if (artBox) summary.boxes.artBox = artBox;
  // Page-local /Resources wins over inherited values.
  const localResources = dict.Resources;
  if (localResources?.kind === "ref") {
    summary.resourceRef = localResources.target;
  } else if (localResources?.kind === "dict") {
    summary.resourceDict = localResources.entries;
  } else if (inherited.resourceRef) {
    summary.resourceRef = inherited.resourceRef;
  } else if (inherited.resourceDict) {
    summary.resourceDict = inherited.resourceDict;
  }
  return summary;
}

/**
 * Parse a /MediaBox-shaped array. Returns undefined when the array is
 * malformed (wrong length, non-numeric elements) — silently potting bad
 * elements down to 0 would surface a "valid" box at the origin, which
 * masks data corruption instead of escalating it.
 */
function readRect(value: PdfValue | undefined): PdfRect | undefined {
  const arr = expectArray(value);
  if (!arr || arr.length < 4) return undefined;
  const nums: number[] = [];
  for (let i = 0; i < 4; i++) {
    const v = arr[i];
    if (!v) return undefined;
    if (v.kind === "int" || v.kind === "real") nums.push(v.value);
    else return undefined;
  }
  const [llx, lly, urx, ury] = nums as [number, number, number, number];
  return { x: llx, y: lly, w: urx - llx, h: ury - lly };
}

function refsFromValue(value: PdfValue | undefined): ObjectId[] {
  if (!value) return [];
  if (value.kind === "ref") return [value.target];
  if (value.kind === "array") {
    const out: ObjectId[] = [];
    for (const item of value.items) if (item.kind === "ref") out.push(item.target);
    return out;
  }
  return [];
}

function normalizeRotation(r: number): 0 | 90 | 180 | 270 {
  const v = ((r % 360) + 360) % 360;
  if (v === 90 || v === 180 || v === 270) return v;
  return 0;
}

function enumerateFormFields(
  tree: PdfDocumentTree | undefined,
  objects: Map<ObjectId, IndirectObject>,
): PdfFormField[] {
  if (!tree?.acroFormRef) return [];
  const acro = objects.get(tree.acroFormRef);
  if (!acro || acro.value.kind !== "dict") return [];
  const fields = expectArray(acro.value.entries.Fields);
  if (!fields) return [];
  const out: PdfFormField[] = [];
  const visited = new Set<ObjectId>();
  for (const fieldRef of fields) {
    const ref = expectRef(fieldRef);
    if (ref) walkFormField(ref, "", objects, out, visited);
  }
  return out;
}

function walkFormField(
  ref: ObjectId,
  parentName: string,
  objects: Map<ObjectId, IndirectObject>,
  out: PdfFormField[],
  visited: Set<ObjectId>,
): void {
  if (visited.has(ref)) return;
  visited.add(ref);
  const obj = objects.get(ref);
  if (!obj || obj.value.kind !== "dict") return;
  const dict = obj.value.entries;
  const partialName = readString(dict.T) ?? "";
  const fullName = partialName
    ? parentName
      ? `${parentName}.${partialName}`
      : partialName
    : parentName;
  // Any presence of /Kids marks this as a non-terminal field per ISO 32000-2
  // §12.7.4.1 — even an empty array. Treating Kids: [] as a leaf turned
  // namespace-only parent nodes into fake "Unknown" fields that polluted
  // the form count.
  const kids = expectArray(dict.Kids);
  if (kids) {
    for (const kid of kids) {
      const kidRef = expectRef(kid);
      if (kidRef) walkFormField(kidRef, fullName, objects, out, visited);
    }
    return;
  }
  const fieldType = pickFieldType(expectName(dict.FT));
  const valueText = readString(dict.V);
  out.push({
    objectRef: ref,
    name: partialName || fullName,
    fullName,
    fieldType,
    ...(valueText ? { value: valueText } : {}),
    signed: fieldType === "Sig" && dict.V?.kind === "ref",
  });
}

function readString(value: PdfValue | undefined): string | undefined {
  if (!value) return undefined;
  if (value.kind === "string") return asciiString(value.raw);
  return undefined;
}

function pickFieldType(name: string | undefined): PdfFormFieldType {
  if (name === "Tx" || name === "Btn" || name === "Ch" || name === "Sig") return name;
  return "Unknown";
}

// =============================================================================
// Phase 4 — File-level feature detection
// =============================================================================

function collectFileInfo(
  reader: ByteReader,
  bytes: Uint8Array,
  structure: StructureParse,
  documents: DocumentGraph,
  objects: Map<ObjectId, IndirectObject>,
): PdfFileInfo {
  const rootTrailerDict = structure.bodies[structure.bodies.length - 1]?.trailer.dict ?? {};
  const signatures = documents.formFields.filter(
    (f) => f.fieldType === "Sig" && f.signed,
  ).length;
  return {
    byteSize: bytes.length,
    pdfVersion: structure.header.version,
    encrypted: !!rootTrailerDict.Encrypt,
    linearized: detectLinearized(reader),
    incrementalUpdates: Math.max(0, structure.bodies.length - 1),
    tagged: detectTagged(documents.tree, objects),
    acroForm: detectAcroForm(documents.tree, objects),
    xfa: detectXfa(documents.tree, objects),
    signatures,
    formFields: documents.formFields.length,
    embeddedFiles: documents.tree?.embeddedFiles?.length ?? 0,
    hasJavaScript: detectJavaScript(documents.tree, objects),
  };
}

function detectLinearized(reader: ByteReader): boolean {
  // Linearized PDFs have a "/Linearized" dictionary near the start.
  const scanEnd = Math.min(2048, reader.end);
  const bytes = reader.subview(0, scanEnd);
  return asciiString(bytes).includes("/Linearized");
}

function detectTagged(
  tree: PdfDocumentTree | undefined,
  objects: Map<ObjectId, IndirectObject>,
): boolean {
  if (!tree?.structTreeRootRef) return false;
  return objects.has(tree.structTreeRootRef);
}

function detectAcroForm(
  tree: PdfDocumentTree | undefined,
  objects: Map<ObjectId, IndirectObject>,
): boolean {
  if (!tree?.acroFormRef) return false;
  return objects.has(tree.acroFormRef);
}

function detectXfa(
  tree: PdfDocumentTree | undefined,
  objects: Map<ObjectId, IndirectObject>,
): boolean {
  if (!tree?.acroFormRef) return false;
  const acro = objects.get(tree.acroFormRef);
  if (!acro || acro.value.kind !== "dict") return false;
  return !!acro.value.entries.XFA;
}

function detectJavaScript(
  tree: PdfDocumentTree | undefined,
  objects: Map<ObjectId, IndirectObject>,
): boolean {
  if (!tree?.namesRef) return false;
  const names = objects.get(tree.namesRef);
  if (!names || names.value.kind !== "dict") return false;
  return !!names.value.entries.JavaScript;
}

// Re-export so call sites can use the same helpers.
export { parseObjectId };
