import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { DEFAULT_INPUT } from "../../src/lib/defaults";
import { generateRecipe } from "../../src/lib/engine";
import type { GenerateRequest, GenerationResponse } from "../../src/lib/types";

const input = (): GenerateRequest => ({
  ...structuredClone(DEFAULT_INPUT), history: [], nonce: "node-browser-identity",
});

function withoutTimestamps(response: GenerationResponse) {
  if (response.status !== "ok") return response;
  return {
    ...response,
    recipe: {
      ...response.recipe, createdAt: "",
      fingerprint: { ...response.recipe.fingerprint, createdAt: "" },
    },
  };
}

test("static export serves same-origin WASM and matches Node recipes without blocking the phone UI", async ({ page, request, baseURL }) => {
  const external: string[] = [];
  page.on("request", (event) => {
    if (new URL(event.url()).origin !== new URL(baseURL!).origin) external.push(event.url());
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  const manifestResponse = await request.get("engine-manifest.json");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#365c3c");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", `${manifest.basePath}/manifest.webmanifest`);
  for (const asset of ["manifest.webmanifest", "icon.svg", "sw.js"]) {
    expect((await request.get(asset)).ok(), asset).toBeTruthy();
  }
  const bridge = await build({
    entryPoints: [path.resolve(__dirname, "../../src/lib/browser-generation.ts")],
    bundle: true, write: false, format: "esm", platform: "browser",
    define: {
      "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(manifest.basePath),
      "process.env.NEXT_PUBLIC_RECIPE_WORKER_PATH": JSON.stringify(manifest.workerPath),
    },
  });
  await page.route("**/__test__/bridge.js", (route) => route.fulfill({
    contentType: "text/javascript", body: bridge.outputFiles[0].text,
  }));
  const wasmResponse = await request.get(`${manifest.basePath}${manifest.workerPath.replace("recipe.worker.js", "highs.wasm")}`);
  expect(wasmResponse.headers()["content-type"]).toBe("application/wasm");
  expect((await request.post(`${manifest.basePath}/api/generations`, { data: input() })).status()).toBe(405);

  const runInBrowser = async (data: GenerateRequest) => page.evaluate(async ({ data, manifest }) => {
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 5);
    try {
      const { browserGenerateRecipe } = await import(`${manifest.basePath}/__test__/bridge.js`);
      const result: GenerationResponse = await browserGenerateRecipe(data);
      return { result, ticks };
    } finally {
      clearInterval(timer);
    }
  }, { data, manifest });

  const original = input();
  const browser = await runInBrowser(original);
  expect(browser.result.status).toBe("ok");
  expect(withoutTimestamps(browser.result)).toEqual(withoutTimestamps(await generateRecipe(original)));
  expect(browser.ticks).toBeGreaterThan(2);
  if (browser.result.status !== "ok") throw new Error("Expected recipe");
  const repeated = { ...input(), history: [browser.result.recipe.fingerprint] };
  expect(withoutTimestamps((await runInBrowser(repeated)).result))
    .toEqual(withoutTimestamps(await generateRecipe(repeated)));

  const fixed = input();
  fixed.pantry = [
    { ingredientId: "greek-yogurt", availableGrams: 250, dietGrams: 175.5, mode: "fixed" },
    { ingredientId: "banana", availableGrams: 200, dietGrams: 90, mode: "fixed" },
  ];
  fixed.preferences.taste = "sweet";
  fixed.targets = { kcal: null, protein: null, carbs: null, fat: null, fiber: null, strictCalories: false };
  const fixedResult = (await runInBrowser(fixed)).result;
  expect(fixedResult.status).toBe("ok");
  expect(withoutTimestamps(fixedResult)).toEqual(withoutTimestamps(await generateRecipe(fixed)));
  if (fixedResult.status === "ok") {
    expect(fixedResult.recipe.ingredients.find((item) => item.ingredientId === "greek-yogurt")?.grams).toBe(175.5);
  }
  const infeasible = { ...fixed, targets: { ...fixed.targets, kcal: 1, strictCalories: true } };
  expect((await runInBrowser(infeasible)).result).toEqual(await generateRecipe(infeasible));
  const empty = { ...input(), pantry: [] };
  expect((await runInBrowser(empty)).result).toEqual(await generateRecipe(empty));
  expect(errors).toEqual([]);
  // Firebase Auth's bootstrap is separate from, and not used by, the local recipe engine.
  expect(external.filter((url) => {
    const { hostname, pathname } = new URL(url);
    return hostname !== "apis.google.com" && !hostname.endsWith(".firebaseapp.com") &&
      !(hostname === "www.google.com" && pathname === "/images/cleardot.gif") &&
      !(hostname === "www.googleapis.com" && pathname === "/identitytoolkit/v3/relyingparty/getProjectConfig");
  })).toEqual([]);
});

test("missing WASM produces an explicit worker error instead of a fabricated recipe", async ({ page, request }) => {
  await page.goto("./");
  const manifest = await (await request.get("engine-manifest.json")).json();
  await page.route("**/highs.wasm", (route) => route.abort("failed"));
  const message = await page.evaluate(async ({ manifest, data }) => {
    return new Promise<{ type: string; message?: string }>((resolve, reject) => {
      const worker = new Worker(`${manifest.basePath}${manifest.workerPath}`);
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error("Worker did not report failure")); }, 20_000);
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve({ type: "error", message: event.message });
      };
      worker.postMessage(data);
    });
  }, { manifest, data: input() });
  expect(message.type).toBe("error");
  expect(message.message).toBeTruthy();
});
