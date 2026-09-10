import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { DEFAULT_INPUT } from "../src/lib/defaults";
import type { GenerateRequest, LocalState, Recipe } from "../src/lib/types";
import {
  generationRequestSchema, imageRequestSchema, localStateSchema, recipeSchema,
} from "../src/lib/validation";
import {
  ApiError, assertLocalRequest, assertMutation, authorizedPlan, BODY_LIMIT, exclusive, getSession,
  hasAiConsent, idempotencyKey, idempotent, isLoopbackUrl, rateLimit,
  readBoundedJson, rememberPlan, responseJson, SESSION_COOKIE,
} from "../src/lib/server/security";
import {
  aiConfiguration, applyCreativeCopy, approvedCopy, buildImagePrompt,
  creativeJsonSchema, decodeImageResponse, parseTextResponse, validateCreativeCopy,
} from "../src/lib/server/ai";
import { imageFileName } from "../src/lib/server/images";

function generation(): GenerateRequest {
  return { ...structuredClone(DEFAULT_INPUT), history: [], nonce: "test-1" };
}

function fixture(): Recipe {
  const nutrients = { kcal: 100, protein: 10, carbs: 10, fat: 2, fiber: 1 };
  const fingerprint = {
    signature: "signature-1", structuralSignature: "structure-1", templateId: "bowl-1",
    ingredientIds: ["chicken"], technique: "padella", cuisine: "mediterranea",
    createdAt: "2026-09-08T12:00:00.000Z",
  };
  return {
    id: "recipe-1", createdAt: fingerprint.createdAt, title: "Pollo in padella",
    description: "Una ricetta editoriale.", templateId: "bowl-1",
    family: "bowl", cuisine: fingerprint.cuisine, technique: fingerprint.technique,
    minutes: 20, difficulty: "easy", servings: 1,
    ingredients: [{
      ingredientId: "chicken", name: "Pollo", grams: 100, state: "crudo",
      role: "proteina", nutrients: { ...nutrients },
    }],
    steps: [{ id: "step-1", title: "Cuoci", instruction: "Cuoci il pollo completamente.", minutes: 15 }],
    nutritionPerServing: { ...nutrients }, nutritionTotal: { ...nutrients },
    targetStatus: "closest", deviations: [], warnings: [], tips: [], substitutions: [],
    variantTip: "Prova un'altra ricetta.", fingerprint, sourceMode: "editorial", planHash: "hash-1",
    fit: {
      addedFatGrams: 0, addedSugarGrams: null, estimatedCookedWeightGrams: null,
      caloricDensity: null, proteinEnergyPercentage: 40, nutritionSource: "Catalogo locale",
    },
    input: structuredClone(DEFAULT_INPUT),
  };
}

function localState(): LocalState {
  return { version: 1, input: structuredClone(DEFAULT_INPUT), recipes: [fixture()], favoriteIds: [], cookedIds: [] };
}

function request(body: unknown = {}, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3000/api/generations", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function status(code: number) {
  return (error: unknown) => error instanceof ApiError && error.status === code;
}

test("fixed contracts parse without supplying defaults or altering nullable targets", () => {
  const value = generation();
  for (const key of ["kcal", "protein", "carbs", "fat", "fiber"] as const) value.targets[key] = null;
  const parsed: GenerateRequest = generationRequestSchema.parse(value);
  assert.deepEqual(parsed, value);
  assert.equal(generationRequestSchema.safeParse({ ...value, preferences: undefined }).success, false);
  const recipe: Recipe = recipeSchema.parse(fixture());
  const state: LocalState = localStateSchema.parse(localState());
  assert.equal(recipe.id, state.recipes[0].id);
});

test("bounded finite quantities and positive fixed per-serving grams", () => {
  for (const availableGrams of [-1, Infinity, -Infinity, NaN, 50_001]) {
    const value = generation();
    value.pantry[0].availableGrams = availableGrams;
    assert.equal(generationRequestSchema.safeParse(value).success, false);
  }
  for (const dietGrams of [undefined, 0, -1, Infinity, NaN, 5_001]) {
    const value = generation();
    value.pantry[0] = { ingredientId: "chicken", availableGrams: 200, mode: "fixed", dietGrams };
    assert.equal(generationRequestSchema.safeParse(value).success, false);
  }
  const value = generation();
  value.pantry[0] = { ingredientId: "chicken", availableGrams: 0, mode: "available", dietGrams: 0 };
  assert.equal(generationRequestSchema.safeParse(value).success, true);
  value.pantry[0] = { ingredientId: "chicken", availableGrams: 0, mode: "fixed", dietGrams: 120 };
  assert.equal(generationRequestSchema.safeParse(value).success, true, "Engine, not syntax validation, explains shortages");
});

test("pantry uniqueness and 60-item maximum; history maximum 30", () => {
  const value = generation();
  value.pantry.push({ ...value.pantry[0] });
  assert.equal(generationRequestSchema.safeParse(value).success, false);
  value.pantry = Array.from({ length: 61 }, (_, i) => ({ ingredientId: `food-${i}`, availableGrams: 10, mode: "available" }));
  assert.equal(generationRequestSchema.safeParse(value).success, false);
  value.pantry.pop();
  assert.equal(generationRequestSchema.safeParse(value).success, true);
  value.history = Array.from({ length: 31 }, () => fixture().fingerprint);
  assert.equal(generationRequestSchema.safeParse(value).success, false);
  value.history.pop();
  assert.equal(generationRequestSchema.safeParse(value).success, true);
});

test("exact enums, no coerced strings, unknown keys or duplicate selectors", () => {
  const value = generation();
  assert.equal(generationRequestSchema.safeParse({
    ...value,
    preferences: {
      ...value.preferences,
      equipment: ["pan", "stove", "oven", "air_fryer", "blender", "microwave", "refrigerator", "thermometer"],
    },
  }).success, true);
  for (const patch of [
    { taste: "salty" }, { goal: "lose" }, { meal: "brunch" }, { difficulty: "hard" },
    { equipment: ["fire"] }, { allergens: ["lactose"] }, { servings: "2" },
    { servings: 1.5 }, { equipment: ["pan", "pan"] }, { maxTime: 241 }, { extra: true },
  ]) assert.equal(generationRequestSchema.safeParse({
    ...value, preferences: { ...value.preferences, ...patch },
  }).success, false);
  assert.equal(generationRequestSchema.safeParse({ ...value, secret: "not-allowed" }).success, false);
  assert.equal(generationRequestSchema.safeParse({ ...value, nonce: "x".repeat(129) }).success, false);
  assert.equal(generationRequestSchema.safeParse({ ...value, nonce: "\n" }).success, false);
  for (const kcal of [-1, 10_001, "500", NaN, Infinity]) {
    assert.equal(generationRequestSchema.safeParse({ ...value, targets: { ...value.targets, kcal } }).success, false);
  }
});

test("variant and history nested data are validated", () => {
  const value = generation();
  value.variant = {
    kind: "faster", baselineNutrition: fixture().nutritionTotal,
    baselineMinutes: 20, baselineRecipeId: "recipe-1",
  };
  assert.equal(generationRequestSchema.safeParse(value).success, true);
  value.variant.baselineMinutes = Infinity;
  assert.equal(generationRequestSchema.safeParse(value).success, false);
  delete value.variant;
  value.history = [{ ...fixture().fingerprint, createdAt: "yesterday" }];
  assert.equal(generationRequestSchema.safeParse(value).success, false);
});

test("persisted recipes reject incomplete steps, invalid macro values and oversized text", () => {
  const value = fixture();
  assert.equal(recipeSchema.safeParse({ ...value, steps: [] }).success, false);
  assert.equal(recipeSchema.safeParse({ ...value, ingredients: [] }).success, false);
  assert.equal(recipeSchema.safeParse({ ...value, title: "x".repeat(161) }).success, false);
  assert.equal(recipeSchema.safeParse({ ...value, nutritionTotal: { ...value.nutritionTotal, kcal: Infinity } }).success, false);
  assert.equal(recipeSchema.safeParse({ ...value, family: "soup" }).success, false);
  assert.equal(recipeSchema.safeParse({ ...value, createdAt: "nonsense" }).success, false);
  assert.equal(recipeSchema.safeParse({ ...value, sourceMode: "pretend-ai" }).success, false);
});

test("persisted image references exclude script/data/remote URLs and mismatching plans", () => {
  const value = fixture();
  const url = "/api/images/b9c2cba1-3f88-454c-8c43-f908a20ffdbd";
  assert.equal(recipeSchema.safeParse({ ...value, image: { url, kind: "ai", planHash: value.planHash } }).success, true);
  for (const bad of ["javascript:alert(1)", "data:image/webp;base64,AAAA", "https://example.com/tracker", "/api/images/../secret"]) {
    assert.equal(recipeSchema.safeParse({ ...value, image: { url: bad, kind: "ai", planHash: value.planHash } }).success, false);
  }
  assert.equal(recipeSchema.safeParse({ ...value, image: { url, kind: "ai", planHash: "other" } }).success, false);
});

test("local state bounds history and rejects stale, duplicate or wrong-version references", () => {
  const state = localState();
  assert.equal(localStateSchema.safeParse({ ...state, version: 2 }).success, false);
  assert.equal(localStateSchema.safeParse({ ...state, recipes: [fixture(), fixture()] }).success, false);
  assert.equal(localStateSchema.safeParse({ ...state, favoriteIds: ["absent"] }).success, false);
  assert.equal(localStateSchema.safeParse({ ...state, cookedIds: ["recipe-1", "recipe-1"] }).success, false);
  state.recipes = Array.from({ length: 101 }, (_, i) => ({ ...fixture(), id: `recipe-${i}` }));
  assert.equal(localStateSchema.safeParse(state).success, false);
  state.recipes.pop();
  state.favoriteIds = state.recipes.slice(0, 50).map((recipe) => recipe.id);
  state.cookedIds = state.recipes.map((recipe) => recipe.id);
  assert.equal(localStateSchema.safeParse(state).success, true);
  assert.equal(localStateSchema.safeParse({
    ...state, favoriteIds: state.recipes.slice(0, 51).map((recipe) => recipe.id),
  }).success, false);
});

test("image request accepts lookup keys and extracts ONLY lookup keys from compatible recipe payload", () => {
  assert.deepEqual(imageRequestSchema.parse({ recipe: fixture() }), { recipeId: "recipe-1", planHash: "hash-1" });
  assert.deepEqual(imageRequestSchema.parse({ recipeId: "recipe-1", planHash: "hash-1" }), { recipeId: "recipe-1", planHash: "hash-1" });
  assert.equal(imageRequestSchema.safeParse({ recipeId: "recipe-1", planHash: "hash-1", prompt: "evil" }).success, false);
});

test("loopback allowlist rejects remote hosts, credentials and disguised localhost names", () => {
  for (const value of ["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"]) assert.equal(isLoopbackUrl(value), true);
  for (const value of ["http://localhost.evil", "http://127.0.0.1.evil", "http://user@localhost", "https://example.com", "file://localhost", "bad"]) {
    assert.equal(isLoopbackUrl(value), false);
  }
});

test("mutations require same origin, same local host and JSON; forwarded IP is never trusted", () => {
  for (const origin of ["http://127.0.0.1:3000", "http://localhost:3000"]) {
    assert.doesNotThrow(() => assertMutation(new Request(`${origin}/api/generations`, {
      method: "POST",
      headers: { origin, host: new URL(origin).host, "content-type": "application/json" },
      body: "{}",
    })));
  }
  assert.throws(() => assertMutation(request({}, { origin: "http://localhost:3000" })), status(403));
  assert.throws(() => assertMutation(request({}, { origin: "http://127.0.0.1:3001" })), status(403));
  assert.doesNotThrow(() => assertMutation(request({}, { "x-forwarded-for": "8.8.8.8" })));
  assert.throws(() => assertMutation(request({}, { origin: "http://attacker.test" })), status(403));
  assert.throws(() => assertMutation(request({}, { origin: "" })), status(403));
  assert.throws(() => assertMutation(request({}, { host: "attacker.test" })), status(403));
  assert.throws(() => assertMutation(request({}, { "sec-fetch-site": "cross-site" })), status(403));
  assert.throws(() => assertMutation(request({}, { "content-type": "text/plain" })), status(415));
  assert.throws(() => assertMutation(request({}, { "content-encoding": "gzip" })), status(415));
  assert.throws(() => assertLocalRequest(new Request("http://127.0.0.1:3000/api/config", {
    headers: { "sec-fetch-site": "cross-site" },
  })), status(403), "Cross-site reads must not allocate opaque sessions");
});

test("installed NextRequest canonicalization preserves exact browser-origin authorization", () => {
  for (const host of ["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]) {
    const origin = `http://${host}`;
    const get = new NextRequest(`${origin}/api/config`, { headers: { host } });
    assert.equal(get.url, "http://localhost:3000/api/config");
    assert.equal(get.headers.get("host"), host);
    assert.equal(assertLocalRequest(get), origin);
    const post = new NextRequest(`${origin}/api/generations`, {
      method: "POST",
      headers: { host, origin, "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: "{}",
    });
    assert.doesNotThrow(() => assertMutation(post));
  }
});

test("canonicalized requests reject origins that match only the internal hostname or another port", () => {
  for (const [host, origin] of [
    ["127.0.0.1:3000", "http://localhost:3000"],
    ["localhost:3000", "http://127.0.0.1:3000"],
    ["127.0.0.1:3000", "http://127.0.0.1:3001"],
    ["127.0.0.1:3001", "http://127.0.0.1:3001"],
    ["localhost:3001", "http://localhost:3001"],
    ["[::1]:3000", "http://localhost:3000"],
    ["127.0.0.1:3000", "https://127.0.0.1:3000"],
  ]) {
    const value = new NextRequest("http://127.0.0.1:3000/api/generations", {
      method: "POST",
      headers: { host, origin, "content-type": "application/json" },
      body: "{}",
    });
    assert.throws(() => assertMutation(value), status(403), `${host} / ${origin}`);
  }
});

test("strict local Host validation ignores forged forwarding headers and rejects remote authorities", () => {
  const forwarding = {
    "x-forwarded-host": "localhost:3000",
    "x-forwarded-port": "3000",
    "x-forwarded-proto": "http",
    forwarded: "for=127.0.0.1;host=localhost:3000;proto=http",
  };
  for (const host of [
    "attacker.test:3000", "localhost.attacker.test:3000", "127.0.0.1.attacker.test:3000",
    "127.2.3.4:3000", "localhost:3000@attacker.test", "attacker.test@localhost:3000",
    "localhost:3000/path", "localhost:3000?ignored", "localhost:3000#ignored",
    "localhost:3000,attacker.test", "localhost:65536", "localhost:0", "localhost:",
  ]) {
    assert.throws(() => assertLocalRequest(new NextRequest("http://127.0.0.1:3000/api/config", {
      headers: { ...forwarding, host },
    })), status(403), host);
  }
  assert.throws(() => assertLocalRequest(new NextRequest("http://attacker.test:3000/api/config", {
    headers: { ...forwarding, host: "localhost:3000" },
  })), status(403));
  assert.doesNotThrow(() => assertMutation(new NextRequest("http://127.0.0.1:3000/api/generations", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json",
      "x-forwarded-host": "attacker.test", "x-forwarded-port": "4000", "x-forwarded-proto": "https",
      forwarded: "host=attacker.test;proto=https",
    },
    body: "{}",
  })));
});

test("AI consent is exact and cannot come from the body", () => {
  assert.equal(hasAiConsent(request({ consent: true })), false);
  for (const value of ["TRUE", "1", "yes", "false"]) assert.equal(hasAiConsent(request({}, { "x-fit-ai-consent": value })), false);
  assert.equal(hasAiConsent(request({}, { "x-fit-ai-consent": "true" })), true);
});

test("streamed JSON enforces actual bytes and declared size", async () => {
  assert.deepEqual(await readBoundedJson(request({ x: 1 })), { x: 1 });
  await assert.rejects(readBoundedJson(request({}, { "content-length": String(BODY_LIMIT + 1) })), status(413));
  await assert.rejects(readBoundedJson(request({ text: "x".repeat(BODY_LIMIT) })), status(413));
  const malformed = new Request("http://localhost:3000", { method: "POST", body: '{"x":' });
  await assert.rejects(readBoundedJson(malformed), status(400));
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"x":"'));
      controller.enqueue(new Uint8Array(100));
      controller.close();
    },
  });
  const streamed = new Request("http://localhost:3000", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readBoundedJson(streamed, 20), status(413));
});

test("opaque cookies isolate sessions and carry HttpOnly SameSite and no-store flags", () => {
  const owner = getSession(request());
  const next = request({}, { cookie: `${SESSION_COOKIE}=${owner.id}` });
  assert.equal(getSession(next, false), owner);
  assert.notEqual(getSession(request()).id, owner.id);
  assert.throws(() => getSession(request({}, { cookie: "fit_session=forged" }), false), status(409));
  const response = responseJson({ status: "ok" }, 200, owner, request());
  assert.match(response.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("idempotency includes canonical payload, consent, operation and header", () => {
  const a = request({}, { "idempotency-key": "click-1" });
  assert.equal(idempotencyKey(a, { a: 1, b: 2 }, "generation"), idempotencyKey(a, { b: 2, a: 1 }, "generation"));
  assert.notEqual(idempotencyKey(a, { a: 1 }, "generation"), idempotencyKey(a, { a: 2 }, "generation"));
  assert.notEqual(idempotencyKey(a, {}, "generation"), idempotencyKey(a, {}, "image"));
  assert.notEqual(idempotencyKey(a, {}, "generation"), idempotencyKey(request(), {}, "generation"));
  assert.notEqual(idempotencyKey(a, {}, "generation"), idempotencyKey(
    request({}, { "idempotency-key": "click-1", "x-fit-ai-consent": "true" }), {}, "generation",
  ));
  assert.throws(() => idempotencyKey(request({}, { "idempotency-key": "x".repeat(129) }), {}, "generation"), status(400));
});

test("in-flight duplicates share work; failures do not poison retries; request cache stays bounded", async () => {
  const session = getSession(request());
  let calls = 0;
  const work = async () => { calls++; return 42; };
  assert.deepEqual(await Promise.all([idempotent(session, "same", work), idempotent(session, "same", work)]), [42, 42]);
  assert.equal(calls, 1);
  await assert.rejects(idempotent(session, "retry", async () => { throw new Error("expected"); }));
  assert.equal(await idempotent(session, "retry", work), 42);
  for (let i = 0; i < 30; i++) await idempotent(session, `unique-${i}`, work);
  assert.ok(session.requests.size <= 12);
});

test("session concurrency blocks different work and releases after errors", async () => {
  const session = getSession(request());
  let release!: () => void;
  const first = exclusive(session, () => new Promise<void>((resolve) => { release = resolve; }));
  await assert.rejects(exclusive(session, async () => 1), status(429));
  release();
  await first;
  await assert.rejects(exclusive(session, async () => { throw new Error("expected"); }));
  assert.equal(await exclusive(session, async () => 2), 2);
});

test("per-session rate cap cannot be bypassed by changing payload", () => {
  const session = getSession(request());
  for (let i = 0; i < 20; i++) rateLimit(session, "generation");
  assert.throws(() => rateLimit(session, "generation"), status(429));
});

test("global paid-image cap survives session churn, without making any provider requests", () => {
  for (let i = 0; i < 10; i++) rateLimit(getSession(request()), "image");
  assert.throws(() => rateLimit(getSession(request()), "image"), status(429));
});

test("global concurrency limits independent sessions and is released correctly", async () => {
  const releases: (() => void)[] = [];
  const pending = Array.from({ length: 4 }, () => exclusive(getSession(request()), () =>
    new Promise<void>((resolve) => { releases.push(resolve); })));
  await assert.rejects(exclusive(getSession(request()), async () => true), status(503));
  for (const release of releases) release();
  await Promise.all(pending);
  assert.equal(await exclusive(getSession(request()), async () => true), true);
});

test("plans require same-session id and hash; client modifications cannot alter prompt authority", () => {
  const owner = getSession(request());
  const recipe = fixture();
  rememberPlan(owner, recipe);
  recipe.ingredients[0].name = "Ananas inventato";
  const authorized = authorizedPlan(owner, "recipe-1", "hash-1");
  assert.equal(authorized.ingredients[0].name, "Pollo");
  authorized.steps[0].instruction = "modificata";
  assert.notEqual(authorizedPlan(owner, "recipe-1", "hash-1").steps[0].instruction, "modificata");
  assert.throws(() => authorizedPlan(getSession(request()), "recipe-1", "hash-1"), status(409));
  assert.throws(() => authorizedPlan(owner, "recipe-1", "forged"), status(409));
  owner.plans.get("recipe-1")!.expires = 0;
  assert.throws(() => authorizedPlan(owner, "recipe-1", "hash-1"), status(409));
});

test("plan cache stays bounded and a replay preserves an already paid image", () => {
  const session = getSession(request());
  const recipe = fixture();
  const image = { url: "/api/images/b9c2cba1-3f88-454c-8c43-f908a20ffdbd", kind: "ai" as const, planHash: recipe.planHash };
  rememberPlan(session, { ...recipe, image });
  rememberPlan(session, recipe);
  assert.deepEqual(authorizedPlan(session, recipe.id, recipe.planHash).image, image);
  for (let i = 0; i < 30; i++) rememberPlan(session, { ...fixture(), id: `recipe-${i}` });
  assert.equal(session.plans.size, 10);
});

test("AI configuration is explicit opt-in and returns no secrets", () => {
  assert.equal(aiConfiguration({}).aiTextAvailable, false);
  assert.equal(aiConfiguration({ OPENAI_API_KEY: "fixture-not-a-key" }).aiTextAvailable, false);
  assert.equal(aiConfiguration({ FIT_ENABLE_AI: "true" }).aiImagesAvailable, false);
  assert.equal(aiConfiguration({ FIT_ENABLE_AI: "TRUE", OPENAI_API_KEY: "fixture" }).aiTextAvailable, false);
  const config = aiConfiguration({ FIT_ENABLE_AI: "true", OPENAI_API_KEY: "fixture" });
  assert.equal(config.aiTextAvailable, true);
  assert.equal(config.aiImagesAvailable, true);
  assert.equal(config.textModel, "gpt-5-mini");
  assert.equal(config.imageModel, "gpt-image-1-mini");
  assert.equal(JSON.stringify(config).includes("fixture"), false);
  assert.equal(aiConfiguration({ FIT_ENABLE_AI: "true", OPENAI_API_KEY: "fixture", OPENAI_TEXT_MODEL: "../bad" }).aiTextAvailable, false);
});

test("creative schema permits only approved bounded wording, rejecting medical claims and absent foods", () => {
  const recipe = fixture();
  const choices = approvedCopy(recipe);
  assert.deepEqual(creativeJsonSchema(recipe).properties.title.enum, choices.titles);
  assert.deepEqual(validateCreativeCopy({ title: choices.titles[1], description: choices.descriptions[2] }, recipe),
    { title: choices.titles[1], description: choices.descriptions[2] });
  for (const title of ["Cura il diabete", "Zero calorie", "Pollo con ananas", "x".repeat(161)]) {
    assert.throws(() => validateCreativeCopy({ title, description: choices.descriptions[0] }, recipe));
  }
  assert.throws(() => validateCreativeCopy({ title: choices.titles[0], description: "Dimagrimento garantito" }, recipe));
  assert.throws(() => validateCreativeCopy({ title: choices.titles[0], description: choices.descriptions[0], kcal: 1 }, recipe));
});

test("AI copy never mutates quantities, nutrition, complete steps, fingerprint or input", () => {
  const recipe = fixture();
  const snapshot = structuredClone(recipe);
  const choices = approvedCopy(recipe);
  const result = applyCreativeCopy(recipe, { title: choices.titles[1], description: choices.descriptions[1] });
  assert.deepEqual(recipe, snapshot);
  assert.equal(result.sourceMode, "ai");
  assert.deepEqual(
    { ...result, title: recipe.title, description: recipe.description, sourceMode: recipe.sourceMode },
    recipe,
  );
});

test("text provider format rejects truncation, refusals, non-JSON and extra creative fields", () => {
  const recipe = fixture();
  const choices = approvedCopy(recipe);
  const content = JSON.stringify({ title: choices.titles[0], description: choices.descriptions[0] });
  const response = { choices: [{ finish_reason: "stop", message: { content, refusal: null } }] };
  assert.equal(parseTextResponse(response, recipe).sourceMode, "ai");
  assert.throws(() => parseTextResponse({ choices: [{ finish_reason: "length", message: { content } }] }, recipe));
  assert.throws(() => parseTextResponse({ choices: [{ finish_reason: "stop", message: { content, refusal: "No" } }] }, recipe));
  assert.throws(() => parseTextResponse({ choices: [{ finish_reason: "stop", message: { content: "not json" } }] }, recipe));
  assert.throws(() => parseTextResponse({ choices: [] }, recipe));
});

test("image prompt contains only server ingredients and no targets, history or invented garnish", () => {
  const recipe = fixture();
  recipe.title = "client title must not guide image";
  const prompt = buildImagePrompt(recipe);
  assert.match(prompt, /Pollo, 100 g/);
  assert.match(prompt, /Do not add herbs/);
  assert.doesNotMatch(prompt, /client title|500|fat_loss|baseline|history|lemon/);
});

test("image response permits bounded canonical WebP base64, never provider URLs or SVG", () => {
  const bytes = Buffer.alloc(24);
  bytes.write("RIFF");
  bytes.writeUInt32LE(16, 4);
  bytes.write("WEBPVP8 ", 8);
  const b64_json = bytes.toString("base64");
  assert.deepEqual(decodeImageResponse({ data: [{ b64_json }] }), bytes);
  assert.throws(() => decodeImageResponse({ data: [{ url: "http://127.0.0.1/secret" }] }), status(502));
  assert.throws(() => decodeImageResponse({ data: [{ b64_json: Buffer.from("<svg onload='bad'/>").toString("base64") }] }), status(502));
  assert.throws(() => decodeImageResponse({ data: [{ b64_json }, { b64_json }] }), status(502));
  assert.throws(() => decodeImageResponse({ data: [{ b64_json: "A".repeat(24) }] }), status(502));
  bytes.writeUInt32LE(1, 4);
  assert.throws(() => decodeImageResponse({ data: [{ b64_json: bytes.toString("base64") }] }), status(502));
});

test("image identifiers cannot traverse paths or address arbitrary filenames", () => {
  assert.equal(imageFileName("b9c2cba1-3f88-454c-8c43-f908a20ffdbd"), "b9c2cba1-3f88-454c-8c43-f908a20ffdbd.webp");
  for (const id of ["../secret", "..\\secret", "C:\\secret", "%2e%2e", "a".repeat(36), "image.webp"]) {
    assert.throws(() => imageFileName(id), status(404));
  }
});
