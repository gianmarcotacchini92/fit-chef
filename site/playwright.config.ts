import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const manifest = JSON.parse(readFileSync(path.join(__dirname, "out", "engine-manifest.json"), "utf8"));
const baseURL = `http://127.0.0.1:4174${manifest.basePath}/`;

export default defineConfig({
  testDir: "tests",
  outputDir: "test-results",
  workers: 1,
  timeout: 120_000,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", serviceWorkers: "block" },
  projects: [{
    name: "static-mobile",
    use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
  }],
  webServer: {
    command: "node scripts/serve-static.mjs --port 4174",
    cwd: path.resolve(__dirname, ".."),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
