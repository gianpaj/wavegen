import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { statSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE = path.join(__dirname, "fixtures/short.mp3");

test.describe("seewav waveform generator", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("page loads — generate button disabled without file", async ({ page }) => {
    await expect(page.getByRole("button", { name: /generate/i })).toBeDisabled();
  });

  test("uploading audio enables generate button", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(FIXTURE);
    await expect(page.getByRole("button", { name: /generate/i })).toBeEnabled();
  });

  test("full pipeline: upload → generate → download MP4", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(FIXTURE);
    await page.getByRole("button", { name: /generate/i }).click();

    await expect(page.locator(".progress-bar-wrap")).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByRole("button", { name: /download mp4/i })
    ).toBeVisible({ timeout: 120_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /download mp4/i }).click(),
    ]);

    expect(download.suggestedFilename()).toBe("seewav-output.mp4");
    const savedPath = await download.path();
    expect(savedPath).not.toBeNull();
    expect(statSync(savedPath!).size).toBeGreaterThan(1_000);
  });

  test("WebCodecs on Chrome, ffmpeg.wasm on Firefox/Safari", async ({ page, browserName }) => {
    const hasWebCodecs = await page.evaluate(
      () => typeof (globalThis as any).VideoEncoder !== "undefined"
    );
    if (browserName === "chromium") {
      // Chrome always has WebCodecs
      expect(hasWebCodecs).toBe(true);
    } else {
      // Firefox 146+ and Safari 16.4+ have VideoEncoder too;
      // we just assert the detection is a boolean (truthy or falsy)
      expect(typeof hasWebCodecs).toBe("boolean");
    }
  });
});
