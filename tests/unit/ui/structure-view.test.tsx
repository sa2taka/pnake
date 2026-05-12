import { describe, expect, it, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../../../src/App";
import { InProcessParserService } from "../../../src/ui/services/parser-service";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

afterEach(cleanup);

function makeTaggedPdf(): File {
  // Catalog → Pages tree → Page → StructTreeRoot → Document → H1 → P
  const header = "%PDF-1.7\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R /MarkInfo << /Marked true >> >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
    "4 0 obj\n<< >>\nendobj\n",
    "5 0 obj\n<< /Type /StructTreeRoot /K 6 0 R >>\nendobj\n",
    "6 0 obj\n<< /Type /StructElem /S /Document /K [7 0 R 8 0 R] >>\nendobj\n",
    "7 0 obj\n<< /Type /StructElem /S /H1 /T (Heading) /K [0] >>\nendobj\n",
    "8 0 obj\n<< /Type /StructElem /S /P /Alt (Hello paragraph) /K [1] >>\nendobj\n",
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
    `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${pad(o)} 00000 n \n`).join("") +
    `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\n`;
  const tail = `startxref\n${xrefOffset}\n%%EOF\n`;
  const bytes = toBytes(header + objects.join("") + xref + tail);
  return new File([new Uint8Array(bytes)], "tagged.pdf", { type: "application/pdf" });
}

describe("StructureView (tagged PDF)", () => {
  it("renders the logical hierarchy when StructTreeRoot is present", async () => {
    const parser = new InProcessParserService();
    render(<App parserService={parser} />);

    const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
    Object.defineProperty(fileInput, "files", {
      value: [makeTaggedPdf()],
      configurable: true,
    });
    fireEvent.change(fileInput);

    // Wait for the manifest.
    await waitFor(() =>
      expect(screen.getAllByText(/1 pages/i).length).toBeGreaterThan(0),
    );

    // Switch tree view to "structure".
    fireEvent.change(screen.getByRole("toolbar").querySelector("select")!, {
      target: { value: "structure" },
    });

    await waitFor(() => {
      expect(screen.getByText("Document")).toBeInTheDocument();
    });
    expect(screen.getByText("H1")).toBeInTheDocument();
    expect(screen.getByText("P")).toBeInTheDocument();
    // MCID children should appear.
    expect(screen.getByText(/MCID 0/)).toBeInTheDocument();
    expect(screen.getByText(/MCID 1/)).toBeInTheDocument();
  });
});
