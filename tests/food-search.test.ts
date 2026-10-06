import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { fetchOffProduct, isValidBarcode, manualFoodSnapshot, resetOffLookupState, searchCatalog } from "../src/lib/food-search";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

test("searchCatalog matches by name and alias, is diacritic- and case-insensitive, and ranks exact/prefix first", () => {
  const byAlias = searchCatalog("pollo");
  assert.ok(byAlias.some((food) => food.id === "chicken"));
  const accentInsensitive = searchCatalog("FRAGOLE");
  assert.ok(accentInsensitive.some((food) => food.id === "strawberries"));
  const results = searchCatalog("rice");
  assert.equal(results[0]?.id, "rice"); // exact alias match ranks before "brown rice" prefix/contains matches
  assert.ok(results.some((food) => food.id === "brown-rice"));
});

test("searchCatalog returns nothing for blank queries and respects the limit", () => {
  assert.deepEqual(searchCatalog("   "), []);
  assert.deepEqual(searchCatalog(""), []);
  assert.ok(searchCatalog("o", 3).length <= 3);
});

test("isValidBarcode accepts only plain digit strings of plausible length", () => {
  assert.equal(isValidBarcode("8001234567890"), true);
  assert.equal(isValidBarcode("123"), false);
  assert.equal(isValidBarcode("12345678901234567890x"), false);
  assert.equal(isValidBarcode("abc12345"), false);
  assert.equal(isValidBarcode("123; DROP TABLE"), false);
  assert.equal(isValidBarcode(" 8001234567890 "), true);
});

test("manualFoodSnapshot builds an honestly-labelled custom food and rejects blank name/state", () => {
  const food = manualFoodSnapshot({ name: "Torta fatta in casa", state: "cotta, fetta", per100g: { kcal: 300, protein: 5, carbs: 40, fat: 12, fiber: 2 } });
  assert.match(food.name, /Torta/);
  assert.match(food.source, /manualmente/);
  assert.equal(food.barcode, undefined);
  assert.throws(() => manualFoodSnapshot({ name: "  ", state: "cotta", per100g: { kcal: 1, protein: 1, carbs: 1, fat: 1, fiber: 1 } }));
  assert.throws(() => manualFoodSnapshot({ name: "Torta", state: " ", per100g: { kcal: 1, protein: 1, carbs: 1, fat: 1, fiber: 1 } }));
});

test("manualFoodSnapshot rejects non-finite nutrients and invalid barcodes", () => {
  assert.throws(() => manualFoodSnapshot({ name: "Torta", state: "cotta", per100g: { kcal: Infinity, protein: 1, carbs: 1, fat: 1, fiber: 1 } }));
  assert.throws(() => manualFoodSnapshot({ name: "Torta", state: "cotta", per100g: { kcal: 1, protein: 1, carbs: 1, fat: 1, fiber: 1 }, barcode: "xyz" }));
});

beforeEach(() => resetOffLookupState());

type N = Record<string, { value: number; unit: string; source?: string }>;
const found = (nutrients: N, extra: Record<string, unknown> = {}, per = "100g") => jsonResponse({
  status: "success", result: { id: "product_found" },
  product: { product_name: "Prodotto esempio", brands: "Marca", nutrition: { aggregated_set: { per, preparation: "as_sold", nutrients, ...extra } } },
});
const full: N = {
  "energy-kcal": { value: 59, unit: "kcal", source: "packaging" }, proteins: { value: 10.3, unit: "g", source: "packaging" },
  carbohydrates: { value: 3.6, unit: "g", source: "packaging" }, fat: { value: .4, unit: "g", source: "packaging" },
  fiber: { value: 0, unit: "g", source: "packaging" },
};

test("fetchOffProduct rejects a non-numeric barcode before making any request", async () => {
  let called = false;
  const result = await fetchOffProduct("not-a-barcode", { fetchImpl: async () => { called = true; return found(full); } });
  assert.equal(result.status, "error");
  assert.equal(called, false);
});

test("fetchOffProduct uses the v3.6 endpoint with only fields and app_name, and no custom headers", async () => {
  let url = "", init: RequestInit | undefined;
  await fetchOffProduct("8001234567890", { fetchImpl: async (input, options) => { url = String(input); init = options; return found(full); } });
  assert.equal(url, "https://world.openfoodfacts.org/api/v3.6/product/8001234567890.json?fields=code,product_name,brands,nutrition&app_name=FitChef");
  assert.equal(init?.headers, undefined);
  assert.equal(init?.method, undefined);
});

test("fetchOffProduct parses a known product per 100 g, keeping declared zero fibre", async () => {
  const result = await fetchOffProduct("8001234567890", { fetchImpl: async () => found(full) });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.deepEqual(result.product.per100g, { kcal: 59, protein: 10.3, carbs: 3.6, fat: .4 });
    assert.equal(result.product.fiber, 0);
    assert.equal(result.product.brands, "Marca");
  }
});

test("fetchOffProduct converts kJ-only energy and leaves undeclared or estimated fibre unknown", async () => {
  const { "energy-kcal": _kcal, fiber: _fiber, ...rest } = full;
  void _kcal; void _fiber;
  const result = await fetchOffProduct("8001234567891", {
    fetchImpl: async () => found({ ...rest, "energy-kj": { value: 1500, unit: "kJ", source: "packaging" }, fiber: { value: 3, unit: "g", source: "estimate" } }),
  });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.product.per100g.kcal, Math.round(1500 / 4.184 * 100) / 100);
    assert.equal(result.product.fiber, null);
  }
});

test("fetchOffProduct never uses estimated essential values or non-100 g bases", async () => {
  const estimated = await fetchOffProduct("8000000000010", { fetchImpl: async () => found({ ...full, proteins: { value: 10, unit: "g", source: "estimate" } }) });
  assert.equal(estimated.status, "error");
  assert.match((estimated as { message: string }).message, /mancanti/);
  const millilitres = await fetchOffProduct("8000000000011", { fetchImpl: async () => found(full, {}, "100ml") });
  assert.equal(millilitres.status, "error");
  assert.match((millilitres as { message: string }).message, /100 g/);
  const perMl = await fetchOffProduct("8000000000013", { fetchImpl: async () => found({ ...full, "energy-kcal": { value: 42, unit: "kcal", source_per: "100ml" } as N[string] }) });
  assert.equal(perMl.status, "error");
  const prepared = await fetchOffProduct("8000000000012", { fetchImpl: async () => found(full, { preparation: "prepared" }) });
  assert.equal(prepared.status, "error");
});

test("fetchOffProduct maps the v3 404 product_not_found body to not-found", async () => {
  const result = await fetchOffProduct("8000000000000", {
    fetchImpl: async () => jsonResponse({ status: "failure", result: { id: "product_not_found" } }, false, 404),
  });
  assert.equal(result.status, "not-found");
});

test("fetchOffProduct reports missing nutrition and HTTP or network failures visibly", async () => {
  const noNutrition = await fetchOffProduct("8000000000001", {
    fetchImpl: async () => jsonResponse({ status: "success", result: { id: "product_found" }, product: { product_name: "X", nutrition: {} } }),
  });
  assert.equal(noNutrition.status, "error");
  const http = await fetchOffProduct("8000000000002", { fetchImpl: async () => jsonResponse({}, false, 503) });
  assert.match((http as { message: string }).message, /503/);
  const offline = await fetchOffProduct("8000000000003", { fetchImpl: async () => { throw new TypeError("fetch failed"); } });
  assert.equal(offline.status, "error");
  assert.match((offline as { message: string }).message, /connessione/);
});

test("fetchOffProduct caches results, shares in-flight lookups and does not cache errors", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return found(full); };
  const [first, second] = await Promise.all([fetchOffProduct("8001111111111", { fetchImpl }), fetchOffProduct("8001111111111", { fetchImpl })]);
  assert.equal(first, second);
  await fetchOffProduct("8001111111111", { fetchImpl });
  assert.equal(calls, 1);
  let failures = 0;
  const failing = async () => { failures++; throw new TypeError("offline"); };
  await fetchOffProduct("8002222222222", { fetchImpl: failing });
  await fetchOffProduct("8002222222222", { fetchImpl: failing });
  assert.equal(failures, 2);
});

test("fetchOffProduct throttles distinct barcodes below the public rate limit and recovers after the window", async () => {
  let clock = 1_000_000, calls = 0;
  const fetchImpl = async () => { calls++; return found(full); };
  for (let index = 0; index < 8; index++) await fetchOffProduct(`80000000${index}00`, { fetchImpl, now: () => clock });
  const blocked = await fetchOffProduct("8999999999999", { fetchImpl, now: () => clock });
  assert.equal(blocked.status, "error");
  assert.match((blocked as { message: string }).message, /secondi/);
  assert.equal(calls, 8);
  clock += 61_000;
  assert.equal((await fetchOffProduct("8999999999999", { fetchImpl, now: () => clock })).status, "ok");
});
