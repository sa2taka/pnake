import { describe, expect, it } from "vitest";
import { decodeWithCMap, parseToUnicodeCMap } from "../../../src/worker/pdf/resources/cmap";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

const HELLO_CMAP = `
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
3 beginbfchar
<0001> <0048>
<0002> <0065>
<0003> <006C>
endbfchar
1 beginbfrange
<0010> <0012> <0041>
endbfrange
endcmap
`;

describe("parseToUnicodeCMap", () => {
  it("decodes bfchar entries to single Unicode code points", () => {
    const cmap = parseToUnicodeCMap(toBytes(HELLO_CMAP));
    expect(cmap.entries.get(0x0001)).toBe("H");
    expect(cmap.entries.get(0x0002)).toBe("e");
    expect(cmap.entries.get(0x0003)).toBe("l");
    expect(cmap.codeByteLengths.has(2)).toBe(true);
  });

  it("expands bfrange entries by incrementing the trailing code unit", () => {
    const cmap = parseToUnicodeCMap(toBytes(HELLO_CMAP));
    expect(cmap.entries.get(0x0010)).toBe("A");
    expect(cmap.entries.get(0x0011)).toBe("B");
    expect(cmap.entries.get(0x0012)).toBe("C");
  });

  it("decodes a byte string through a CMap", () => {
    const cmap = parseToUnicodeCMap(toBytes(HELLO_CMAP));
    // "Hello" but only H/e/l/l in the CMap (we left out 'o'). Verify what we can.
    const bytes = new Uint8Array([0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x03]);
    expect(decodeWithCMap(cmap, bytes)).toBe("Hell");
  });

  it("supports bfrange with array target", () => {
    const src = `
2 beginbfrange
<0030> <0030> [<0030>]
<0040> <0042> [<0041> <0042> <0043>]
endbfrange
    `;
    const cmap = parseToUnicodeCMap(toBytes(src));
    expect(cmap.entries.get(0x0030)).toBe("0");
    expect(cmap.entries.get(0x0040)).toBe("A");
    expect(cmap.entries.get(0x0041)).toBe("B");
    expect(cmap.entries.get(0x0042)).toBe("C");
  });

  it("records codespace ranges and uses them to advance past undefined codes", () => {
    const src = `
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
1 beginbfchar
<0041> <0061>
endbfchar
    `;
    const cmap = parseToUnicodeCMap(toBytes(src));
    expect(cmap.codespaceRanges).toEqual([{ width: 2, start: 0x0000, end: 0xffff }]);

    // 4 bytes: one known (0x0041 → "a"), then 2 bytes of unknown. The
    // fallback must advance by 2 (the codespace width) so we don't desync.
    const bytes = new Uint8Array([0x00, 0x41, 0x00, 0xff]);
    const out = decodeWithCMap(cmap, bytes);
    expect(out).toBe("a�");
  });
});
