import assert from "node:assert/strict";
import test from "node:test";
import { parseNaturalMeal } from "../src/lib/natural-meal";
import { foodSnapshotSchema } from "../src/lib/nutrition-diary";

test("recognizes pala pizza varieties and fried pieces without external APIs", () => {
  const result = parseNaturalMeal("Ho mangiato 3 pezzi di pizza margherita, 2 pezzi di pizza patate, un supplì e 2 crocchette");
  assert.deepEqual(result.unresolved, []);
  assert.equal(result.items.length, 4);
  assert.deepEqual(result.items.map((item) => item.grams), [270, 180, 100, 120]);
  assert.ok(result.items.every((item) => item.estimated));
  for (const item of result.items) assert.equal(foodSnapshotSchema.safeParse(item.food).success, true);
});

test("recognizes weighed common ingredients and leaves missing portions unresolved", () => {
  const result = parseNaturalMeal("90 g di riso, 150 g di pollo, 10 g olio evo");
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.items.map((item) => item.food.id), ["rice", "chicken", "olive-oil"]);
  assert.deepEqual(result.items.map((item) => item.grams), [90, 150, 10]);
  assert.equal(result.items.some((item) => item.estimated), false);
  const uncertain = parseNaturalMeal("pizza margherita, 2 uova, 100 g ingrediente inesistente");
  assert.equal(uncertain.items.length, 0);
  assert.equal(uncertain.unresolved.length, 3);
});

test("supports personal saved foods and never guesses a gram value from a piece", () => {
  const personal = foodSnapshotSchema.parse({
    id: "personal-pancakes", name: "Pancake fatti in casa", state: "cotti",
    source: "ricetta di prova", per100g: { kcal: 220, protein: 15, carbs: 27, fat: 6, fiber: 2 },
  });
  const exact = parseNaturalMeal("120 g pancake fatti in casa", [personal]);
  assert.equal(exact.items[0]?.food.id, personal.id);
  assert.equal(exact.items[0]?.grams, 120);
  const pieces = parseNaturalMeal("2 pezzi di pancake fatti in casa", [personal]);
  assert.equal(pieces.items.length, 0);
  assert.equal(pieces.unresolved.length, 1);
});

test("rejects missing pizza flavor and unrealistic weights", () => {
  assert.equal(parseNaturalMeal("3 pezzi pizza").unresolved.length, 1);
  assert.equal(parseNaturalMeal("10000 g riso").items.length, 0);
});
