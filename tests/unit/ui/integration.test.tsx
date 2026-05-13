import { describe, expect, it, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../../../src/App";
import { InProcessParserService } from "../../../src/ui/services/parser-service";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

afterEach(cleanup);

function makePdf(): File {
  const header = "%PDF-1.7\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ];
  let cursor = header.length;
  const offsets = objects.map((o) => {
    const off = cursor;
    cursor += o.length;
    return off;
  });
  const xrefOffset = cursor;
  const pad = (n: number) => n.toString().padStart(10, "0");
  const body =
    "xref\n0 4\n" +
    "0000000000 65535 f \n" +
    `${pad(offsets[0]!)} 00000 n \n` +
    `${pad(offsets[1]!)} 00000 n \n` +
    `${pad(offsets[2]!)} 00000 n \n` +
    "trailer\n<< /Size 4 /Root 1 0 R >>\n";
  const tail = `startxref\n${xrefOffset}\n%%EOF\n`;
  const bytes = toBytes(header + objects.join("") + body + tail);
  return new File([new Uint8Array(bytes)], "tiny.pdf", { type: "application/pdf" });
}

describe("App integration (InProcessParserService)", () => {
  it("loads a PDF, populates the tree, and opens object detail", async () => {
    const parser = new InProcessParserService();
    render(<App parserService={parser} />);

    const fileInput = screen.getByTestId("file-input");
    Object.defineProperty(fileInput, "files", {
      value: [makePdf()],
      configurable: true,
    });
    fireEvent.change(fileInput);

    // Wait until the manifest has been applied.
    await waitFor(() => {
      expect(screen.getByText(/3 objects/i)).toBeInTheDocument();
    });

    // The Catalog row should be auto-selected and shown in the detail panel.
    await waitFor(() => {
      expect(screen.getByTestId("detail-panel")).toHaveTextContent("Catalog");
    });

    // Clicking the Page row should swap detail to it.
    fireEvent.click(screen.getByTestId("tree-row-obj:3:0"));
    await waitFor(() => {
      expect(screen.getByTestId("detail-panel")).toHaveTextContent("obj:3:0");
    });
  });
});
