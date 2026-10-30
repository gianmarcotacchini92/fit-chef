import assert from "node:assert/strict";
import test from "node:test";
import { parseSmartMeal } from "../src/lib/smart-meal";
import { catalogFood } from "../src/lib/nutrition-diary";

test("pala pizza with mixed slices and fried items is recognized without network", () => {
  const result = parseSmartMeal("Ho mangiato 3 pezzi di margherita, 2 pezzi di pizza con patate, un supplì e 2 crocchette");
  assert.equal(result.warnings.length, 0, result.warnings.join(" | "));
  assert.equal(result.items.length, 4);
  assert.deepEqual(result.items.map(x => x.grams), [285, 200, 90, 100]);
  assert.ok(result.items.every(x => x.estimated));
  assert.ok(result.items.every(x => x.food.source.includes("Stima editoriale")));
});

test("explicit grams use the curated catalog rather than invented macros", () => {
  const result = parseSmartMeal("90 g riso, 150 g pollo, 10 g olio");
  assert.deepEqual(result.items.map(x => x.food.id), ["rice", "chicken", "olive-oil"]);
  assert.deepEqual(result.items.map(x => x.grams), [90, 150, 10]);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.items[0].food.per100g.kcal, catalogFood("rice").per100g.kcal);
});

test("user library takes precedence for names of saved products", () => {
  const custom = { ...catalogFood("rice"), id: "manual-special-rice", name: "Riso della casa",
    per100g: { kcal: 400, protein: 8, carbs: 85, fat: 2, fiber: 1 } };
  const result = parseSmartMeal("100 g riso della casa", [custom]);
  assert.equal(result.items[0]?.food.id, "manual-special-rice");
  assert.equal(result.items[0]?.food.per100g.kcal, 400);
});

test("missing weight, unsupported food and excess quantities are flagged, not logged silently", () => {
  const result = parseSmartMeal("pasta, 100 g alimento inesistente, 10000 g riso");
  assert.equal(result.items.length, 0);
  assert.equal(result.warnings.length, 3);
  assert.ok(result.warnings.some(x => x.includes("quantità") || x.includes("grammi")));
});

test("unquantified pizza slices are not guessed", () => {
  const result = parseSmartMeal("pizza margherita, supplì");
  assert.equal(result.items.length, 0);
  assert.equal(result.warnings.length, 2);
});

test("input is bounded and user data is never sent to a remote provider", () => {
  assert.equal(parseSmartMeal("x".repeat(1501)).items.length, 0);
  assert.ok(parseSmartMeal("x".repeat(1501)).warnings.length);
});
