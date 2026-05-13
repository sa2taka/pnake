import { describe, expect, it, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../../../src/App";
import { InProcessParserService } from "../../../src/ui/services/parser-service";
import { toBytes } from "../../../src/worker/pdf/io/byte-reader";

afterEach(cleanup);

function makeTwoPagePdf(): File {
  const header = "%PDF-1.7\n";
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R >>\nendobj\n",
    "5 0 obj\n<< /Length 4 >>\nstream\nq Q\nendstream\nendobj\n",
    "6 0 obj\n<< /Length 6 >>\nstream\nBT ET\nendstream\nendobj\n",
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
    "xref\n0 7\n0000000000 65535 f \n" +
    offsets.map((o) => `${pad(o)} 00000 n \n`).join("") +
    "trailer\n<< /Size 7 /Root 1 0 R >>\n";
  const tail = `startxref\n${xrefOffset}\n%%EOF\n`;
  const bytes = toBytes(header + objects.join("") + xref + tail);
  return new File([new Uint8Array(bytes)], "two.pdf", { type: "application/pdf" });
}

describe("Page navigation", () => {
  it("loads operations for page 2 after clicking Next", async () => {
    const parser = new InProcessParserService();
    render(<App parserService={parser} />);

    const fileInput = screen.getByTestId("file-input");
    Object.defineProperty(fileInput, "files", {
      value: [makeTwoPagePdf()],
      configurable: true,
    });
    fireEvent.change(fileInput);

    // Wait for the manifest to land.
    await waitFor(() => expect(screen.getAllByText(/2 pages/i).length).toBeGreaterThan(0));

    // Switch to Content view; page 1 has "q Q".
    fireEvent.change(screen.getByRole("toolbar").querySelector("select")!, {
      target: { value: "content" },
    });

    await waitFor(() => {
      const ops = screen.queryAllByTestId(/tree-op-/);
      expect(ops.length).toBeGreaterThan(0);
    });
    const page1Text = screen
      .getAllByTestId(/tree-op-/)
      .map((el) => el.textContent ?? "")
      .join("|");
    expect(page1Text).toMatch(/q/);

    // Click Next page.
    fireEvent.click(screen.getByRole("button", { name: /Next page/i }));

    await waitFor(() => {
      const text = screen
        .queryAllByTestId(/tree-op-/)
        .map((el) => el.textContent ?? "")
        .join("|");
      expect(text).toMatch(/BT/);
      expect(text).toMatch(/ET/);
    });
  });
});
