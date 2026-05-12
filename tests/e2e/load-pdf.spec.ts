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

  test("renders the page with PDF.js and lists content operators", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("file-input");
    await input.setInputFiles(TRACEMONKEY);

    // Wait for the canvas to receive backing-store dimensions, meaning PDF.js
    // finished rendering. Polling on the attribute keeps us robust against
    // timing differences between webkit and chromium.
    const canvas = page.getByTestId("render-canvas");
    await expect.poll(async () => Number(await canvas.getAttribute("width"))).toBeGreaterThan(0);
    await expect.poll(async () => Number(await canvas.getAttribute("height"))).toBeGreaterThan(0);

    // Switch to Content view; the operator list should be non-empty.
    await page
      .getByRole("toolbar")
      .locator("select")
      .selectOption({ label: "Content" });
    await expect(page.locator('[data-testid^="tree-op-"]').first()).toBeVisible();
  });

  test("navigating to page 2 updates the operator timeline", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("file-input");
    await input.setInputFiles(TRACEMONKEY);

    await page
      .getByRole("toolbar")
      .locator("select")
      .selectOption({ label: "Content" });
    await expect(page.locator('[data-testid^="tree-op-"]').first()).toBeVisible();
    const page1Count = await page.locator('[data-testid^="tree-op-"]').count();
    const page1Snippet = (
      await page
        .locator('[data-testid^="tree-op-"]')
        .allInnerTexts()
    ).slice(0, 8).join("\n");

    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByTestId("toolbar-page")).toContainText("2 /");
    await expect.poll(async () => {
      return (
        await page.locator('[data-testid^="tree-op-"]').allInnerTexts()
      )
        .slice(0, 8)
        .join("\n");
    }).not.toBe(page1Snippet);

    const page2Count = await page.locator('[data-testid^="tree-op-"]').count();
    expect(page2Count).toBeGreaterThan(0);
    // Sanity: the two pages should be measurably different in size.
    expect(Math.abs(page2Count - page1Count)).toBeGreaterThan(0);
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
