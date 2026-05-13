/**
 * Capture README screenshots from the running app.
 *
 * Run via Playwright against the preview server:
 *   pnpm capture:screenshots
 *
 * Output lands in docs/images/. Annotations (arrows, labels) are
 * applied separately via ImageMagick — see scripts/annotate.sh.
 *
 * This file is NOT part of the regular e2e suite — it's gated behind
 * `pnpm capture:screenshots` (which uses --grep) so a normal `pnpm e2e`
 * run doesn't rewrite committed images.
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..");
const TRACEMONKEY = path.join(here, "fixtures", "tracemonkey.pdf");
const OUT_DIR = path.join(ROOT, "docs", "images");

// Larger viewport gives the README hero shot more breathing room.
test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.serial("pnake — README screenshots", () => {
  test("empty state", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[role="toolbar"]');
    await page.screenshot({ path: path.join(OUT_DIR, "01-empty.png"), fullPage: false });
  });

  test("loaded — full UI hero", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(TRACEMONKEY);
    await expect(page.getByTestId("detail-panel")).toContainText(/Catalog/);
    // Give PDF.js + overlay a beat to settle.
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, "02-loaded.png"), fullPage: false });
  });

  test("objects view", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(TRACEMONKEY);
    await expect(page.getByTestId("detail-panel")).toContainText(/Catalog/);
    await page.getByRole("toolbar").locator("select").selectOption({ label: "Objects" });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, "03-objects-view.png") });
  });

  test("pages view", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(TRACEMONKEY);
    await expect(page.getByTestId("detail-panel")).toContainText(/Catalog/);
    await page.getByRole("toolbar").locator("select").selectOption({ label: "Pages" });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, "04-pages-view.png") });
  });

  test("content view with operator explanation", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(TRACEMONKEY);
    await expect(page.getByTestId("detail-panel")).toContainText(/Catalog/);
    await page.getByRole("toolbar").locator("select").selectOption({ label: "Content" });
    // Wait for the operator list to populate.
    await page.waitForSelector('[data-testid^="tree-op-"]');
    // Click a Tj (text-show) operator if present, else first op.
    const tj = page
      .getByTestId(/tree-op-/)
      .filter({ hasText: "Tj" })
      .first();
    if (await tj.count()) await tj.click();
    else
      await page
        .getByTestId(/tree-op-/)
        .first()
        .click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, "05-content-view.png") });
  });

  test("structure view", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(TRACEMONKEY);
    await expect(page.getByTestId("detail-panel")).toContainText(/Catalog/);
    await page.getByRole("toolbar").locator("select").selectOption({ label: "Structure" });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, "06-structure-view.png") });
  });

  test("bottom drawer — hex stream preview", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(TRACEMONKEY);
    await expect(page.getByTestId("detail-panel")).toContainText(/Catalog/);

    // Open the drawer (it starts closed).
    await page.getByRole("button", { name: /show drawer/i }).click();

    // Pick a row that has a stream — the chip ends in "·S".
    const streamRow = page.locator(".treepanel-row", { hasText: "·S" }).first();
    await expect(streamRow).toBeVisible();
    await streamRow.click();

    const drawer = page.getByTestId("bottom-drawer");
    await expect(drawer.locator(".bottomdrawer-hex-offset").first()).toBeVisible();
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, "07-bottom-drawer.png") });
  });
});
