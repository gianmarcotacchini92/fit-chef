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

test("everyday dinner: polpette in bianco and roast pork slices are recognized", () => {
  const result = parseSmartMeal("4 polpette in bianco, 2 fette di arrosto di maiale");
  assert.deepEqual(result.warnings, []);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(item => item.grams), [180, 130]);
  assert.ok(result.items.every(item => item.estimated));
  assert.ok(result.items.every(item => item.food.source.includes("Stima editoriale")));
});

test("home cooked dishes with declared gram weight keep weight and label uncertain macros", () => {
  const result = parseSmartMeal("180 g polpette in bianco, 130 g arrosto di maiale");
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.items.map(item => item.grams), [180, 130]);
  assert.ok(result.items.every(item => item.estimated));
});

test("home cooked dishes without any quantity still require clarification", () => {
  const result = parseSmartMeal("polpette in bianco, arrosto di maiale");
  assert.equal(result.items.length, 0);
  assert.equal(result.warnings.length, 2);
});

test("everyday plated dishes handle pieces and portions conservatively", () => {
  const result = parseSmartMeal("2 fette di polpettone, 1 porzione di lasagna");
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.items.map(item => item.grams), [170, 180]);
});


test("pizza crostino supports pieces and declared grams with explicit assumptions", () => {
  for (const phrase of ["2 pezzi di pizza crostino", "due fette di pizza al crostino"]) {
    const result = parseSmartMeal(phrase);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.items[0]?.food.id, "estimate-pizza-crostino");
    assert.equal(result.items[0]?.grams, 200);
    assert.match(result.items[0].food.source, /70% pizza bianca/);
    assert.match(result.items[0].food.source, /non misurato/);
    assert.ok(Math.abs(result.items[0].food.per100g.kcal - 267.5) < 0.001);
  }
  const weighed = parseSmartMeal("180,5 g pizza crostino");
  assert.equal(weighed.items[0]?.grams, 180.5);
  assert.match(weighed.items[0].description, /nutrienti stimati/);
  assert.equal(parseSmartMeal("pizza crostino").items.length, 0);
  assert.match(parseSmartMeal("pizza crostino").warnings[0], /quanti pezzi/);
  assert.equal(parseSmartMeal("2 crostini").items.length, 0);
});

test("pizza crostino coexists with other foods and respects a saved product", () => {
  const meal = parseSmartMeal("2 pezzi di pizza crostino, 150 g pollo, un supplì");
  assert.deepEqual(meal.warnings, []);
  assert.deepEqual(meal.items.map(item => item.grams), [200,150,90]);
  const custom = { ...catalogFood("rice"), id: "my-crostino", name: "Pizza crostino" };
  assert.equal(parseSmartMeal("150 g pizza crostino", [custom]).items[0]?.food.id, custom.id);
});
