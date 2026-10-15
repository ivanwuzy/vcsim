import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = process.env.PLAYWRIGHT_BROWSER_PATH || (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome") ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
export default defineConfig({ testDir: "./e2e", fullyParallel: false, workers: 1, timeout: 60000,
  use: { baseURL: process.env.E2E_URL || "http://localhost:3000", headless: true, viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: chrome }, trace: "retain-on-failure" },
  reporter: [["list"]] });
