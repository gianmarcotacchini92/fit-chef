import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyDietItems, formatNumber, normalizeFoodName, parseDiet, parseMealText } from "../src/lib/pantry";
import { INGREDIENTS } from "../src/lib/catalog";
import type { Ingredient } from "../src/lib/types";

const catalog: Ingredient[] = [
  { id: "chicken", name: "Petto di pollo", aliases: ["pollo"], emoji: "", category: "protein", state: "crudo", nutrients: { kcal: 120, protein: 22.5, carbs: 0, fat: 2.6, fiber: 0 }, allergens: [], vegetarian: false, addedSugar: 0, defaultGrams: 150, source: "fixture" },
  { id: "rice", name: "Riso", aliases: ["riso secco"], emoji: "", category: "carb", state: "secco", nutrients: { kcal: 365, protein: 7, carbs: 79, fat: .7, fiber: 1 }, allergens: [], vegetarian: true, addedSugar: 0, defaultGrams: 80, source: "fixture" },
];

test("diet import accepts quantities before or after a known food and decimal commas", () => {
  const result = parseDiet("150 g pollo\nriso 80,5 g", catalog);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items, [{ ingredientId: "chicken", grams: 150 }, { ingredientId: "rice", grams: 80.5 }]);
});

test("meal text accepts conjunctions, plus signs, and commas without splitting decimal grams", () => {
  for (const text of ["150 g pollo e 80,5 g riso", "150 g pollo + 80,5 g riso", "150 g pollo, 80,5 g riso"]) {
    const result = parseDiet(text, catalog);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.items, [{ ingredientId: "chicken", grams: 150 }, { ingredientId: "rice", grams: 80.5 }]);
  }
});

test("diet import rejects ambiguous unknown, duplicate, zero, or unquantified foods", () => {
  assert.equal(parseDiet("verdure libere\n0 g pollo\n80 g sconosciuto", catalog).errors.length, 3);
  assert.equal(parseDiet("150 g pollo\n50 g pollo", catalog).errors.length, 1);
  assert.equal(parseDiet("", catalog).errors.length, 1);
});

test("confirmed diet import fixes per-serving amount and updates total inventory without mutation", () => {
  const pantry = [{ ingredientId: "chicken", availableGrams: 200, mode: "available" as const }];
  const result = applyDietItems(pantry, [{ ingredientId: "chicken", grams: 150 }, { ingredientId: "rice", grams: 80 }], 2);
  assert.deepEqual(result[0], { ingredientId: "chicken", availableGrams: 300, mode: "fixed", dietGrams: 150 });
  assert.equal(result[1].availableGrams, 160);
  assert.equal(pantry[0].availableGrams, 200);
});

test("Italian normalization and number formatting", () => {
  assert.equal(normalizeFoodName("  Caffè "), "caffe");
  assert.equal(formatNumber(54.8383, 1), "54,8");
});

test("Italian gram units work before and after food names, with decimals and whitespace", () => {
  for (const unit of ["g", "gr", "gr.", "grammo", "grammi", "GR.", "G."]) {
    for (const text of [`90,5 ${unit} pasta`, `pasta 90,5 ${unit}`, `  90.5 ${unit}   PASTA  `]) {
      assert.deepEqual(parseDiet(text, INGREDIENTS), { items: [{ ingredientId: "pasta", grams: 90.5 }], errors: [] }, text);
    }
  }
  for (const text of ["90gr pasta", "pasta: 90 gr", "90 pasta", "pasta 90"]) {
    assert.deepEqual(parseDiet(text, INGREDIENTS), { items: [{ ingredientId: "pasta", grams: 90 }], errors: [] }, text);
  }
  assert.equal(normalizeFoodName("  Riso   secco "), "riso secco");
});

test("the reported meal recognizes every food, preserving weights and leaving tomatoes unquantified", () => {
  const result = parseMealText("Pomodori\n90 gr pasta\n80 gr Philadelphia", INGREDIENTS);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.items.map(({ ingredientId, grams }) => ({ ingredientId, grams })), [
    { ingredientId: "tomato", grams: null },
    { ingredientId: "pasta", grams: 90 },
    { ingredientId: "cream-cheese", grams: 80 },
  ]);
  assert.match(result.items[2].notice!, /generica/);
  assert.match(result.items[2].notice!, /non.*light|ad esempio light/);
  assert.equal(parseDiet("Pomodori\n90 gr pasta\n80 gr Philadelphia", INGREDIENTS).errors.length, 1);
  assert.deepEqual(parseMealText("Pomodori 150 gr.\nPasta 90 grammi\nPhiladelphia 80 g", INGREDIENTS).items.map((item) => item.grams), [150, 90, 80]);
});

test("meal recognition does not guess unknown foods, branded variants, duplicates or invalid grams", () => {
  for (const text of ["80 gr Philadelphia light", "80 gr Philadelphia vegetale", "Philadelphia senza lattosio", "0 gr pasta", "-5 gr pasta", "5001 gr pasta", "90 kg pasta", "90 gr pasta\npasta", "1e3 g pasta"]) {
    assert.equal(parseMealText(text, INGREDIENTS).errors.length, 1, text);
  }
  assert.match(parseMealText("Verdure libere", INGREDIENTS).errors[0], /indica quale verdura/);
  assert.equal(parseMealText("pomodorini", INGREDIENTS).items[0].grams, null);
  assert.deepEqual(parseMealText("  - Pomodori\n* 90 gr pasta\n- 80 gr Philadelphia", INGREDIENTS).errors, []);
  assert.match(parseMealText("200 gr carne rossa", INGREDIENTS).errors[0], /specifica tipo e taglio/);
  assert.match(parseMealText("200 gr carne bianca", INGREDIENTS).errors[0], /specifica tipo e taglio/);
  assert.deepEqual(parseDiet("200 gr macinato magro di manzo", INGREDIENTS).items, [{ ingredientId: "lean-beef", grams: 200 }]);
});
