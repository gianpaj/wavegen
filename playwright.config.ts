import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chrome-desktop",  use: { ...devices["Desktop Chrome"] } },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"] } },
    { name: "safari-desktop",  use: { ...devices["Desktop Safari"] } },
    { name: "chrome-mobile",   use: { ...devices["Pixel 7"] } },
    { name: "firefox-mobile",  use: { ...devices["Moto G4"] } },
    { name: "safari-mobile",   use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: "bun server.ts",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
  },
});
