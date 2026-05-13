/**
 * Single-byte encodings used when a Type 1 / TrueType font omits a
 * /ToUnicode CMap. We don't load the full Adobe Glyph List — instead
 * we ship the WinAnsi / MacRoman → Unicode mappings the spec
 * specifies in Annex D, which covers ~99% of real-world non-CID
 * Latin PDFs.
 *
 * Other encodings (Standard, MacExpert, with /Differences overrides)
 * fall back to ASCII passthrough.
 */

function build(extras: readonly [number, string][]): ReadonlyMap<number, string> {
  const map = new Map<number, string>();
  // Range 0x21..0x7E maps to printable ASCII identity.
  for (let b = 0x21; b <= 0x7e; b++) {
    map.set(b, String.fromCharCode(b));
  }
  for (const [code, ch] of extras) {
    map.set(code, ch);
  }
  return map;
}

const WIN_ANSI = build([
  [0x80, "€"],
  [0x82, "‚"],
  [0x83, "ƒ"],
  [0x84, "„"],
  [0x85, "…"],
  [0x86, "†"],
  [0x87, "‡"],
  [0x88, "ˆ"],
  [0x89, "‰"],
  [0x8a, "Š"],
  [0x8b, "‹"],
  [0x8c, "Œ"],
  [0x8e, "Ž"],
  [0x91, "‘"],
  [0x92, "’"],
  [0x93, "“"],
  [0x94, "”"],
  [0x95, "•"],
  [0x96, "–"],
  [0x97, "—"],
  [0x98, "˜"],
  [0x99, "™"],
  [0x9a, "š"],
  [0x9b, "›"],
  [0x9c, "œ"],
  [0x9e, "ž"],
  [0x9f, "Ÿ"],
  [0xa0, " "],
  // Range 0xA1..0xFF mirrors Latin-1 (WinAnsi == Latin-1 in this band).
  ...Array.from({ length: 0xff - 0xa1 + 1 }, (_, i): [number, string] => [
    0xa1 + i,
    String.fromCharCode(0xa1 + i),
  ]),
]);

const MAC_ROMAN = build([
  [0x80, "Ä"],
  [0x81, "Å"],
  [0x82, "Ç"],
  [0x83, "É"],
  [0x84, "Ñ"],
  [0x85, "Ö"],
  [0x86, "Ü"],
  [0x87, "á"],
  [0x88, "à"],
  [0x89, "â"],
  [0x8a, "ä"],
  [0x8b, "ã"],
  [0x8c, "å"],
  [0x8d, "ç"],
  [0x8e, "é"],
  [0x8f, "è"],
  [0x90, "ê"],
  [0x91, "ë"],
  [0x92, "í"],
  [0x93, "ì"],
  [0x94, "î"],
  [0x95, "ï"],
  [0x96, "ñ"],
  [0x97, "ó"],
  [0x98, "ò"],
  [0x99, "ô"],
  [0x9a, "ö"],
  [0x9b, "õ"],
  [0x9c, "ú"],
  [0x9d, "ù"],
  [0x9e, "û"],
  [0x9f, "ü"],
  [0xa0, "†"],
  [0xa1, "°"],
  [0xa2, "¢"],
  [0xa3, "£"],
  [0xa4, "§"],
  [0xa5, "•"],
  [0xa6, "¶"],
  [0xa7, "ß"],
  [0xa8, "®"],
  [0xa9, "©"],
  [0xaa, "™"],
]);

export function decodeWithEncoding(encoding: string | undefined, bytes: Uint8Array): string {
  const table = encoding ? pickTable(encoding) : undefined;
  if (!table) {
    // Last resort: ASCII identity with non-printable bytes folded out.
    let s = "";
    for (const b of bytes) {
      s += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "·";
    }
    return s;
  }
  let s = "";
  for (const b of bytes) {
    s += table.get(b) ?? "·";
  }
  return s;
}

function pickTable(name: string): ReadonlyMap<number, string> | undefined {
  switch (name) {
    case "WinAnsiEncoding":
      return WIN_ANSI;
    case "MacRomanEncoding":
      return MAC_ROMAN;
    default:
      return undefined;
  }
}
