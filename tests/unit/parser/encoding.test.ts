import { describe, expect, it } from "vitest";
import { decodeWithEncoding } from "../../../src/worker/pdf/resources/encoding";

describe("decodeWithEncoding", () => {
  it("ASCII identity for printable bytes regardless of encoding name", () => {
    const bytes = new Uint8Array([0x48, 0x69, 0x21]); // "Hi!"
    expect(decodeWithEncoding("WinAnsiEncoding", bytes)).toBe("Hi!");
    expect(decodeWithEncoding("MacRomanEncoding", bytes)).toBe("Hi!");
  });

  it("WinAnsi handles smart-quote bytes correctly", () => {
    const bytes = new Uint8Array([0x91, 0x92, 0x93, 0x94]);
    expect(decodeWithEncoding("WinAnsiEncoding", bytes)).toBe("‘’“”");
  });

  it("MacRoman maps Ä at 0x80", () => {
    expect(decodeWithEncoding("MacRomanEncoding", new Uint8Array([0x80]))).toBe("Ä");
  });

  it("unknown encoding falls back to ASCII printable with · placeholder", () => {
    const bytes = new Uint8Array([0x41, 0x00, 0x42]);
    expect(decodeWithEncoding(undefined, bytes)).toBe("A·B");
  });
});
