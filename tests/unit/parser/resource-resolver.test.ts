import { describe, expect, it } from "vitest";
import { resolveResources } from "../../../src/worker/pdf/resources/resolver";
import type { IndirectObject } from "../../../src/worker/pdf/parse/object-reader";
import type { ObjectId } from "../../../src/shared/ir-types";

function makeDict(entries: Record<string, unknown>): IndirectObject["value"] {
  const dict: Record<string, IndirectObject["value"]> = {};
  for (const [k, v] of Object.entries(entries)) {
    dict[k] = toValue(v);
  }
  return { kind: "dict", entries: dict };
}

function toValue(v: unknown): IndirectObject["value"] {
  if (typeof v === "string" && v.startsWith("/")) {
    return { kind: "name", value: v.slice(1) };
  }
  if (typeof v === "string" && /^obj:/.test(v)) {
    return { kind: "ref", target: v as ObjectId };
  }
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { kind: "int", value: v }
      : { kind: "real", value: v };
  }
  if (Array.isArray(v)) {
    return { kind: "array", items: v.map(toValue) };
  }
  if (typeof v === "object" && v !== null) {
    return makeDict(v as Record<string, unknown>);
  }
  return { kind: "null" };
}

function objects(map: Record<string, IndirectObject["value"]>): Map<ObjectId, IndirectObject> {
  const out = new Map<ObjectId, IndirectObject>();
  for (const [id, value] of Object.entries(map)) {
    const m = /^obj:(\d+):(\d+)$/.exec(id);
    if (!m) continue;
    const oid = id as ObjectId;
    out.set(oid, {
      id: oid,
      number: Number(m[1]),
      generation: Number(m[2]),
      range: { start: 0, end: 0 },
      value,
    });
  }
  return out;
}

describe("resolveResources", () => {
  it("returns empty maps when no resource ref is present", () => {
    const res = resolveResources({
      pageNumber: 1,
      objects: new Map(),
    });
    expect(res.fonts).toEqual({});
    expect(res.xobjects).toEqual({});
  });

  it("collects fonts with subtype, BaseFont, encoding, ToUnicode", () => {
    const map = objects({
      "obj:10:0": makeDict({
        Font: { F1: "obj:11:0" },
      }),
      "obj:11:0": makeDict({
        Type: "/Font",
        Subtype: "/Type1",
        BaseFont: "/Helvetica",
        Encoding: "/WinAnsiEncoding",
        ToUnicode: "obj:12:0",
      }),
      "obj:12:0": makeDict({}),
    });
    const res = resolveResources({
      pageNumber: 1,
      resourceRef: "obj:10:0",
      objects: map,
    });
    expect(res.fonts.F1).toMatchObject({
      objectRef: "obj:11:0",
      name: "F1",
      subtype: "Type1",
      baseFont: "Helvetica",
      encoding: "WinAnsiEncoding",
      toUnicodeRef: "obj:12:0",
    });
  });

  it("detects embedded fonts through FontDescriptor", () => {
    const map = objects({
      "obj:10:0": makeDict({
        Font: { F1: "obj:11:0" },
      }),
      "obj:11:0": makeDict({
        Type: "/Font",
        Subtype: "/TrueType",
        BaseFont: "/ABC+CustomFont",
        FontDescriptor: "obj:13:0",
      }),
      "obj:13:0": makeDict({
        FontFile2: "obj:14:0",
      }),
      "obj:14:0": makeDict({}),
    });
    const res = resolveResources({
      pageNumber: 1,
      resourceRef: "obj:10:0",
      objects: map,
    });
    expect(res.fonts.F1?.embedded).toBe(true);
  });

  it("collects XObjects with width/height/subtype", () => {
    const map = objects({
      "obj:10:0": makeDict({
        XObject: { Im1: "obj:20:0" },
      }),
      "obj:20:0": {
        kind: "stream",
        dict: {
          Type: { kind: "name", value: "XObject" },
          Subtype: { kind: "name", value: "Image" },
          Width: { kind: "int", value: 1024 },
          Height: { kind: "int", value: 768 },
          BitsPerComponent: { kind: "int", value: 8 },
          ColorSpace: { kind: "name", value: "DeviceRGB" },
          Filter: { kind: "name", value: "FlateDecode" },
        },
        handle: { objectRef: "obj:20:0", filters: ["FlateDecode"], length: 0 },
      },
    });
    const res = resolveResources({
      pageNumber: 1,
      resourceRef: "obj:10:0",
      objects: map,
    });
    expect(res.xobjects.Im1).toMatchObject({
      name: "Im1",
      subtype: "Image",
      width: 1024,
      height: 768,
      colorSpace: "DeviceRGB",
      bitsPerComponent: 8,
    });
  });

  it("falls back to inherited resources when the page omits them", () => {
    const map = objects({
      "obj:30:0": makeDict({
        Font: { F1: "obj:11:0" },
      }),
      "obj:11:0": makeDict({
        Subtype: "/Type1",
        BaseFont: "/Helvetica",
      }),
    });
    const res = resolveResources({
      pageNumber: 1,
      inheritedResourceRef: "obj:30:0",
      objects: map,
    });
    expect(res.fonts.F1?.baseFont).toBe("Helvetica");
  });
});
