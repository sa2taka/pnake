import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const TRACEMONKEY = path.join(here, "fixtures", "tracemonkey.pdf");

test.describe("pnake — load tracemonkey.pdf", () => {
  test("loads a famous PDF and shows the object tree", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("toolbar")).toBeVisible();

    // Upload tracemonkey.pdf through the hidden file input.
    const input = page.getByTestId("file-input");
    await input.setInputFiles(TRACEMONKEY);

    // Tree panel populates with objects.
    const tree = page.getByTestId("tree-panel");
    await expect(tree).toContainText("objects");

    // The status bar should report PDF version, page count, and object count.
    const status = page.locator(".statusbar");
    await expect(status).toContainText(/v1\.\d/);
    await expect(status).toContainText(/\d+ objs/);
    await expect(status).toContainText(/14 pages/);

    // Catalog should be the first auto-selected node.
    const detail = page.getByTestId("detail-panel");
    await expect(detail).toContainText(/Catalog/);
  });

  test("clicking a page object updates the detail panel", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("file-input");
    await input.setInputFiles(TRACEMONKEY);

    // Switch tree to Pages view, click first page.
    await page
      .getByRole("toolbar")
      .locator("select")
      .selectOption({ label: "Pages" });

    const firstPageRow = page
      .locator(".treepanel-row")
      .filter({ has: page.locator(".treepanel-row-id", { hasText: /^Page 1$/ }) });
    await expect(firstPageRow).toBeVisible();
    await firstPageRow.click();

    const detail = page.getByTestId("detail-panel");
    await expect(detail).toContainText(/MediaBox/);
  });

  test("the bottom drawer renders a hex view of stream bytes", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("file-input");
    await input.setInputFiles(TRACEMONKEY);

    // Toggle drawer open.
    await page.getByRole("button", { name: /show drawer/i }).click();

    // Find any object that has a stream (chip ends with "·S") and click it.
    const streamRow = page.locator(".treepanel-row", { hasText: "·S" }).first();
    await expect(streamRow).toBeVisible();
    await streamRow.click();

    const drawer = page.getByTestId("bottom-drawer");
    await expect(drawer).toBeVisible();
    // Hex view shows lines like "00000000 ..."
    await expect(drawer.locator(".bottomdrawer-hex-offset").first()).toBeVisible();
  });
});
