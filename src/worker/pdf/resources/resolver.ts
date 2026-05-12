/**
 * Resource dictionary resolver (ISO 32000-2 §7.8).
 *
 * Given a /Resources dict (direct or indirect), produces a typed
 * PdfResolvedResources record. Font / XObject entries are augmented
 * with the metadata the rest of the inspector cares about (subtype,
 * size, filters, ToUnicode pointer, etc.).
 */

import type {
  ObjectId,
  PdfDict,
  PdfFilter,
  PdfFontResource,
  PdfResolvedResources,
  PdfValue,
  PdfXObjectResource,
} from "../../../shared/ir-types";
import type { IndirectObject } from "../parse/object-reader";
import {
  dictGet,
  expectArray,
  expectInt,
  expectName,
  expectRef,
  extractFilters,
} from "../parse/value-parser";

export interface ResolveInput {
  pageNumber: number;
  /** Page-local /Resources reference (preferred when present). */
  resourceRef?: ObjectId;
  /** Page-local /Resources dictionary, inline. */
  resourceDict?: PdfDict;
  /** Fallback /Resources reference inherited from an ancestor /Pages. */
  inheritedResourceRef?: ObjectId;
  /** Fallback inline /Resources dict inherited from an ancestor /Pages. */
  inheritedResourceDict?: PdfDict;
  objects: Map<ObjectId, IndirectObject>;
}

export function resolveResources(input: ResolveInput): PdfResolvedResources {
  const resourceDict =
    input.resourceDict ??
    readResourceDict(input.resourceRef, input.objects) ??
    input.inheritedResourceDict ??
    readResourceDict(input.inheritedResourceRef, input.objects);

  return {
    pageNumber: input.pageNumber,
    fonts: collectFonts(resourceDict?.Font, input.objects),
    xobjects: collectXObjects(resourceDict?.XObject, input.objects),
    extGStates: collectRefMap(resourceDict?.ExtGState, input.objects),
    colorSpaces: collectRefMap(resourceDict?.ColorSpace, input.objects),
    patterns: collectRefMap(resourceDict?.Pattern, input.objects),
    shadings: collectRefMap(resourceDict?.Shading, input.objects),
    properties: collectPropertiesDicts(resourceDict?.Properties, input.objects),
    procSets: collectProcSet(resourceDict?.ProcSet),
  };
}

function collectPropertiesDicts(
  value: PdfValue | undefined,
  objects: Map<ObjectId, IndirectObject>,
): Record<string, PdfDict> {
  const dict = resolveDict(value, objects);
  if (!dict) return {};
  const out: Record<string, PdfDict> = {};
  for (const [name, slot] of Object.entries(dict)) {
    if (slot.kind === "dict") {
      out[name] = slot.entries;
    } else if (slot.kind === "ref") {
      const ref = objects.get(slot.target);
      if (ref?.value.kind === "dict") out[name] = ref.value.entries;
    }
  }
  return out;
}

// =============================================================================
// Resource dictionary lookup
// =============================================================================

function readResourceDict(
  ref: ObjectId | undefined,
  objects: Map<ObjectId, IndirectObject>,
): PdfDict | undefined {
  if (!ref) return undefined;
  const obj = objects.get(ref);
  if (!obj) return undefined;
  if (obj.value.kind !== "dict") return undefined;
  return obj.value.entries;
}

function resolveDict(
  value: PdfValue | undefined,
  objects: Map<ObjectId, IndirectObject>,
): PdfDict | undefined {
  if (!value) return undefined;
  if (value.kind === "dict") return value.entries;
  if (value.kind === "ref") {
    const target = objects.get(value.target);
    if (!target) return undefined;
    if (target.value.kind === "dict") return target.value.entries;
  }
  return undefined;
}

// =============================================================================
// Fonts
// =============================================================================

function collectFonts(
  value: PdfValue | undefined,
  objects: Map<ObjectId, IndirectObject>,
): Record<string, PdfFontResource> {
  const result: Record<string, PdfFontResource> = {};
  const dict = resolveDict(value, objects);
  if (!dict) return result;
  for (const [name, slot] of Object.entries(dict)) {
    const ref = expectRef(slot);
    if (!ref) continue;
    const obj = objects.get(ref);
    if (!obj || obj.value.kind !== "dict") {
      result[name] = {
        objectRef: ref,
        name,
        subtype: "Unknown",
        embedded: false,
      };
      continue;
    }
    const fontDict = obj.value.entries;
    result[name] = {
      objectRef: ref,
      name,
      subtype: pickFontSubtype(expectName(fontDict.Subtype)),
      baseFont: expectName(fontDict.BaseFont),
      encoding: extractEncodingName(fontDict.Encoding, objects),
      toUnicodeRef: expectRef(fontDict.ToUnicode),
      embedded: detectEmbeddedFont(fontDict, objects),
    };
  }
  return result;
}

function pickFontSubtype(name: string | undefined): PdfFontResource["subtype"] {
  switch (name) {
    case "Type0":
    case "Type1":
    case "Type3":
    case "MMType1":
    case "TrueType":
    case "CIDFontType0":
    case "CIDFontType2":
      return name;
    default:
      return "Unknown";
  }
}

function extractEncodingName(
  value: PdfValue | undefined,
  objects: Map<ObjectId, IndirectObject>,
): string | undefined {
  if (!value) return undefined;
  if (value.kind === "name") return value.value;
  if (value.kind === "ref") {
    const obj = objects.get(value.target);
    if (obj?.value.kind === "dict") {
      return expectName(obj.value.entries.BaseEncoding);
    }
  }
  if (value.kind === "dict") {
    return expectName(value.entries.BaseEncoding);
  }
  return undefined;
}

function detectEmbeddedFont(
  fontDict: PdfDict,
  objects: Map<ObjectId, IndirectObject>,
): boolean {
  // PDF embeds font programs via /FontDescriptor's /FontFile / /FontFile2 /
  // /FontFile3. For Type0 fonts we hop through /DescendantFonts first.
  const visited = new Set<ObjectId>();
  const stack: PdfValue[] = [];
  if (fontDict.FontDescriptor) stack.push(fontDict.FontDescriptor);
  if (fontDict.DescendantFonts) stack.push(fontDict.DescendantFonts);

  while (stack.length > 0) {
    const value = stack.pop()!;
    if (value.kind === "ref") {
      if (visited.has(value.target)) continue;
      visited.add(value.target);
      const obj = objects.get(value.target);
      if (obj?.value.kind === "dict") stack.push({ kind: "dict", entries: obj.value.entries });
      continue;
    }
    if (value.kind === "dict") {
      if (value.entries.FontFile || value.entries.FontFile2 || value.entries.FontFile3) {
        return true;
      }
      if (value.entries.FontDescriptor) stack.push(value.entries.FontDescriptor);
      if (value.entries.DescendantFonts) stack.push(value.entries.DescendantFonts);
      continue;
    }
    if (value.kind === "array") {
      for (const item of value.items) stack.push(item);
    }
  }
  return false;
}

// =============================================================================
// XObjects
// =============================================================================

function collectXObjects(
  value: PdfValue | undefined,
  objects: Map<ObjectId, IndirectObject>,
): Record<string, PdfXObjectResource> {
  const result: Record<string, PdfXObjectResource> = {};
  const dict = resolveDict(value, objects);
  if (!dict) return result;
  for (const [name, slot] of Object.entries(dict)) {
    const ref = expectRef(slot);
    if (!ref) continue;
    const obj = objects.get(ref);
    if (!obj || (obj.value.kind !== "stream" && obj.value.kind !== "dict")) {
      result[name] = {
        objectRef: ref,
        name,
        subtype: "Unknown",
        filters: [],
      };
      continue;
    }
    const d = obj.value.kind === "stream" ? obj.value.dict : obj.value.entries;
    const subtype = pickXObjectSubtype(expectName(d.Subtype));
    const resource: PdfXObjectResource = {
      objectRef: ref,
      name,
      subtype,
      filters: obj.value.kind === "stream" ? extractFilters(d) : [],
    };
    const width = expectInt(d.Width);
    if (width != null) resource.width = width;
    const height = expectInt(d.Height);
    if (height != null) resource.height = height;
    const cs = expectName(d.ColorSpace);
    if (cs) resource.colorSpace = cs;
    const bpc = expectInt(d.BitsPerComponent);
    if (bpc != null) resource.bitsPerComponent = bpc;
    result[name] = resource;
  }
  return result;
}

function pickXObjectSubtype(name: string | undefined): PdfXObjectResource["subtype"] {
  if (name === "Image" || name === "Form" || name === "PS") return name;
  return "Unknown";
}

// =============================================================================
// Generic ref maps for ExtGState / ColorSpace / Pattern / Shading
// =============================================================================

function collectRefMap(
  value: PdfValue | undefined,
  objects: Map<ObjectId, IndirectObject>,
): Record<string, ObjectId> {
  const out: Record<string, ObjectId> = {};
  const dict = resolveDict(value, objects);
  if (!dict) return out;
  for (const [name, slot] of Object.entries(dict)) {
    const ref = expectRef(slot);
    if (ref) out[name] = ref;
  }
  return out;
}

function collectProcSet(value: PdfValue | undefined): string[] {
  const arr = expectArray(value);
  if (!arr) return [];
  return arr.flatMap((v) => (v.kind === "name" ? [v.value] : []));
}

// Helpers re-exported so callers can reuse them when displaying details.
export { dictGet, expectInt, expectName, expectRef, expectArray, extractFilters };
export type { PdfFilter };
