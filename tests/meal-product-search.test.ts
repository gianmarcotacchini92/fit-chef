import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { parseMealProducts, searchMealProducts, resetMealProductSearch } from "../src/lib/meal-product-search";
const product = { code: "12345678", product_name: "Yogurt prova", brands: "Marca", nutrition_data_per: "100g", nutriments: {
  "energy-kcal_100g": 70, proteins_100g: 5, carbohydrates_100g: 7, fat_100g: 2, fiber_100g: 0,
} };
beforeEach(resetMealProductSearch);
test("search products require complete per-100g nutrients and explicit product identity", () => {
  const result = parseMealProducts({ products: [product] });
  assert.equal(result.foods.length, 1);
  assert.match(result.foods[0].source, /Open Food Facts/);
  assert.match(result.foods[0].source, /12345678/);
  for (const bad of [{ ...product, nutrition_data_per: "100ml" }, { ...product, nutriments: { ...product.nutriments, fiber_100g: undefined } }, { ...product, nutriments: { ...product.nutriments, fat_100g: -1 } }, { ...product, code: "invalid" }]) assert.equal(parseMealProducts({ products: [bad] }).foods.length, 0);
});
test("explicit search sends only query, caches success and throttles requests", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls++;
    const url = new URL(String(input)); assert.equal(url.searchParams.get("search_terms"), "yogurt");
    assert.equal(init?.credentials, "omit"); assert.equal(init?.body, undefined);
    return Response.json({ products: [product] });
  };
  await searchMealProducts("yogurt", { fetchImpl }); await searchMealProducts("yogurt", { fetchImpl });
  assert.equal(calls, 1);
  const fail: typeof fetch = async () => new Response("", { status: 503 });
  for (let i = 0; i < 4; i++) await assert.rejects(searchMealProducts(`prodotto${i}`, { fetchImpl: fail }));
  await assert.rejects(searchMealProducts("altro", { fetchImpl: fail }), /Attendi/);
});
test("malformed and oversized responses fail instead of becoming food records", async () => {
  await assert.rejects(searchMealProducts("yogurt", { fetchImpl: async () => new Response("bad JSON") }));
  await assert.rejects(searchMealProducts("yogurt", { fetchImpl: async () => new Response("x".repeat(256001)) }), /troppo grande/);
});
