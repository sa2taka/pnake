import { describe, expect, it } from "vitest";
import { ParserState, StaleSessionError } from "../../../src/worker/handlers";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

function buildPdf(label: string): ArrayBuffer {
  const header = "%PDF-1.7\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${label.length} >>\nstream\n${label}\nendstream\nendobj\n`,
  ];
  let cursor = header.length;
  const offsets = objects.map((o) => {
    const off = cursor;
    cursor += o.length;
    return off;
  });
  const xrefOffset = cursor;
  const pad = (n: number) => n.toString().padStart(10, "0");
  const xref =
    "xref\n0 5\n0000000000 65535 f \n" +
    offsets.map((o) => `${pad(o)} 00000 n \n`).join("") +
    "trailer\n<< /Size 5 /Root 1 0 R >>\n";
  const tail = `startxref\n${xrefOffset}\n%%EOF\n`;
  return toBytes(header + objects.join("") + xref + tail).slice().buffer;
}

describe("ParserState — stale session handling", () => {
  it("an older getPageOperations is rejected once a newer load arrives", async () => {
    const state = new ParserState();
    await state.load(buildPdf("AAAA"));

    // Start an async getPageOperations but do not await yet.
    const pendingOps = state.getPageOperations(1);
    // Kick off a new load before the previous async work could settle. Since
    // load is async too, the new session is taken even if its body has not
    // finished yet.
    const reload = state.load(buildPdf("BB"));
    await reload;

    await expect(pendingOps).rejects.toBeInstanceOf(StaleSessionError);
  });

  it("a getStream interleaved with a new load is rejected", async () => {
    const state = new ParserState();
    await state.load(buildPdf("CCC"));
    const pendingStream = state.getStream("obj:4:0", "decoded").catch((err) => err);
    await state.load(buildPdf("DD"));
    const settled = await pendingStream;
    expect(settled).toBeInstanceOf(StaleSessionError);
  });

  it("two concurrent loads — only the latest survives", async () => {
    const state = new ParserState();
    const first = state.load(buildPdf("EE"));
    const second = state.load(buildPdf("FFFF"));
    const [a, b] = await Promise.allSettled([first, second]);
    // The losing load rejects with StaleSessionError; the winner resolves.
    const statuses = [a.status, b.status];
    expect(statuses).toContain("fulfilled");
    expect(statuses).toContain("rejected");
    const loser = a.status === "rejected" ? a.reason : (b as PromiseRejectedResult).reason;
    expect(loser).toBeInstanceOf(StaleSessionError);
  });
});
