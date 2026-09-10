import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { browserGenerateRecipe, BROWSER_GENERATION_TIMEOUT_MS } from "../src/lib/browser-generation";
import { DEFAULT_INPUT } from "../src/lib/defaults";
import { hashJson } from "../src/lib/portable-hash";
import type { GenerateRequest, GenerationResponse } from "../src/lib/types";

const request = (): GenerateRequest => ({
  ...structuredClone(DEFAULT_INPUT), history: [], nonce: "browser-bridge-test",
});

test("portable SHA-256 exactly matches Node JSON hashing, including Unicode", async () => {
  for (const value of [
    null, "", "è à 🍋", [1, 0.1, "pollo", "acidità"],
    { catalog: "test", grams: 37.5, empty: [], state: "crudo" }, request(),
  ]) {
    assert.equal(await hashJson(value), createHash("sha256").update(JSON.stringify(value)).digest("hex"));
  }
  await assert.rejects(hashJson(undefined), TypeError);
});

test("browser bridge isolates concurrent requests and terminates every finished worker", async (t) => {
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const previousPath = process.env.NEXT_PUBLIC_RECIPE_WORKER_PATH;
  const previousBase = process.env.NEXT_PUBLIC_BASE_PATH;
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    request?: GenerateRequest;
    constructor(public url: string) { FakeWorker.instances.push(this); }
    postMessage(value: GenerateRequest) {
      if (value.nonce === "uncloneable") throw new DOMException("Cannot clone input", "DataCloneError");
      this.request = value;
    }
    terminate() { this.terminated = true; }
  }
  Object.defineProperty(globalThis, "Worker", { configurable: true, writable: true, value: FakeWorker });
  process.env.NEXT_PUBLIC_RECIPE_WORKER_PATH = "/engine/version/recipe.worker.js";
  process.env.NEXT_PUBLIC_BASE_PATH = "/fit-chef";
  t.after(() => {
    if (previousWorker) Object.defineProperty(globalThis, "Worker", previousWorker);
    else Reflect.deleteProperty(globalThis, "Worker");
    if (previousPath === undefined) delete process.env.NEXT_PUBLIC_RECIPE_WORKER_PATH;
    else process.env.NEXT_PUBLIC_RECIPE_WORKER_PATH = previousPath;
    if (previousBase === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previousBase;
  });
  const first = browserGenerateRecipe(request());
  const second = browserGenerateRecipe({ ...request(), nonce: "second" });
  assert.equal(FakeWorker.instances[0].url, "/fit-chef/engine/version/recipe.worker.js");
  assert.equal(FakeWorker.instances[1].request?.nonce, "second");
  const result: GenerationResponse = { status: "infeasible", message: "No plan", details: ["Fixed constraints"] };
  FakeWorker.instances[1].onmessage!({ data: { type: "result", result } });
  assert.deepEqual(await second, result);
  assert.equal(FakeWorker.instances[1].terminated, true);
  assert.equal(FakeWorker.instances[0].terminated, false);
  FakeWorker.instances[0].onmessage!({ data: { type: "error", message: "HiGHS load failed" } });
  await assert.rejects(first, /HiGHS load failed/);
  assert.equal(FakeWorker.instances[0].terminated, true);

  const failed = browserGenerateRecipe(request());
  FakeWorker.instances[2].onerror!({ message: "Missing WASM", preventDefault() {} });
  await assert.rejects(failed, /Missing WASM/);
  assert.equal(FakeWorker.instances[2].terminated, true);

  const malformed = browserGenerateRecipe(request());
  FakeWorker.instances[3].onmessage!({ data: null });
  await assert.rejects(malformed, /non riconosciuta/);
  assert.equal(FakeWorker.instances[3].terminated, true);

  const unreadable = browserGenerateRecipe(request());
  FakeWorker.instances[4].onmessageerror!();
  await assert.rejects(unreadable, /leggere/);
  assert.equal(FakeWorker.instances[4].terminated, true);

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const expired = browserGenerateRecipe(request());
  t.mock.timers.tick(BROWSER_GENERATION_TIMEOUT_MS);
  await assert.rejects(expired, /120 secondi/);
  assert.equal(FakeWorker.instances[5].terminated, true);
  assert.equal(FakeWorker.instances[5].onmessage, null);

  await assert.rejects(browserGenerateRecipe({ ...request(), nonce: "uncloneable" }), /Cannot clone input/);
  assert.equal(FakeWorker.instances[6].terminated, true);

  delete process.env.NEXT_PUBLIC_RECIPE_WORKER_PATH;
  await assert.rejects(browserGenerateRecipe(request()), /non incluso/);
  Reflect.deleteProperty(globalThis, "Worker");
  await assert.rejects(browserGenerateRecipe(request()), /non supporta i Web Worker/);
});
