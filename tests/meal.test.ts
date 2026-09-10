import { strict as assert } from "node:assert";
import { test } from "node:test";
import { confirmMealExtra, createMealBase, getMealExtraSuggestions, ingredientRestriction, mealBaseNutrition, mealGenerationInput, recipeMealBreakdown } from "../src/lib/meal";
import { DEFAULT_INPUT } from "../src/lib/defaults";
import { getIngredient } from "../src/lib/catalog";
import { generateRecipe } from "../src/lib/engine";

test("meal foods keep their exact per-serving weights and scale only total availability", () => {
  const base = createMealBase([{ ingredientId: "chicken", grams: 150 }, { ingredientId: "zucchini", grams: 200 }], 2);
  assert.deepEqual(base, [
    { ingredientId: "chicken", dietGrams: 150, availableGrams: 300, mode: "fixed" },
    { ingredientId: "zucchini", dietGrams: 200, availableGrams: 400, mode: "fixed" },
  ]);
  assert.throws(() => createMealBase([{ ingredientId: "unknown", grams: 100 }], 1), /riconosciuto/);
  assert.throws(() => createMealBase([{ ingredientId: "chicken", grams: 0 }], 1), /quantita/);
  assert.throws(() => createMealBase([{ ingredientId: "chicken", grams: 150 }], 0), /porzioni/);
  assert.throws(() => createMealBase([{ ingredientId: "chicken", grams: 150 }, { ingredientId: "chicken", grams: 50 }], 1), /ripetere/);
});

test("an extra enters the pantry only through explicit confirmation and never changes the meal", () => {
  const base = createMealBase([{ ingredientId: "chicken", grams: 150 }, { ingredientId: "zucchini", grams: 200 }], 2);
  const saved = structuredClone(base);
  const confirmed = confirmMealExtra(base, "olive-oil", 5, 2, true);
  assert.deepEqual(base, saved);
  assert.deepEqual(confirmed.slice(0, 2), saved);
  assert.deepEqual(confirmed[2], { ingredientId: "olive-oil", mode: "preferred", dietGrams: 5, availableGrams: 10 });
  assert.deepEqual(confirmMealExtra(confirmed, "olive-oil", 0, 2, false), saved);
  assert.throws(() => confirmMealExtra(base, "chicken", 20, 2, true), /gia parte/);
  assert.throws(() => confirmMealExtra(base, "olive-oil", 0, 2, true), /quantita/);
});

test("old fridge stock is never silently authorized as an extra in meal mode", () => {
  const input = structuredClone(DEFAULT_INPUT);
  input.pantry = input.pantry.map((item) => item.ingredientId === "chicken" ? { ...item, mode: "fixed", dietGrams: 150 } : item);
  const snapshot = structuredClone(input);
  const meal = mealGenerationInput(input);
  assert.equal(meal.pantry.length, 1);
  assert.equal(meal.pantry[0].ingredientId, "chicken");
  assert.deepEqual(input, snapshot);
  input.pantry = confirmMealExtra(input.pantry, "olive-oil", 5, 1, true);
  assert.deepEqual(mealGenerationInput(input).pantry.map((item) => item.ingredientId).sort(), ["chicken", "olive-oil"]);
});

test("base nutrient preview is per serving, independent from confirmed extras and servings", () => {
  const base = createMealBase([{ ingredientId: "chicken", grams: 150 }, { ingredientId: "zucchini", grams: 200 }], 2);
  const preview = mealBaseNutrition(confirmMealExtra(base, "olive-oil", 5, 2, true));
  assert.ok(preview);
  assert.equal(preview.kcal, 199);
  assert.ok(Math.abs(preview.protein - 37.05) < .00001);
  assert.equal(mealBaseNutrition([]), null);
});

test("suggestions are separate from pantry and respect base identity and culinary context", () => {
  const base = createMealBase([{ ingredientId: "greek-yogurt", grams: 170 }, { ingredientId: "banana", grams: 100 }], 1);
  const snapshot = structuredClone(base);
  const suggestions = getMealExtraSuggestions(base, "sweet");
  assert.ok(suggestions.some((item) => item.ingredientId === "cocoa"));
  assert.ok(!suggestions.some((item) => item.ingredientId === "greek-yogurt"));
  assert.ok(!suggestions.some((item) => item.ingredientId === "wheat-flour"));
  assert.deepEqual(base, snapshot);
  assert.deepEqual(getMealExtraSuggestions([], "savory"), []);
  const preferences = { ...DEFAULT_INPUT.preferences, allergens: ["milk"] };
  assert.match(ingredientRestriction(getIngredient("greek-yogurt")!, preferences)!, /allergene/);
});

test("recipe breakdown uses the recipe nutrient snapshot, separates every extra, and adds back to the total", async () => {
  const input = structuredClone(DEFAULT_INPUT);
  input.preferences.servings = 2;
  input.pantry = input.pantry.map((item) => ({ ...item, availableGrams: item.availableGrams * 2 }));
  input.pantry = input.pantry.map((item) => item.ingredientId === "chicken" ? { ...item, mode: "fixed", dietGrams: 145 } : item);
  const generated = await generateRecipe({ ...input, nonce: "meal-accounting", history: [] });
  assert.equal(generated.status, "ok");
  if (generated.status !== "ok") throw new Error(JSON.stringify(generated));
  const result = recipeMealBreakdown(generated.recipe)!;
  assert.equal(result.baseItems.length, 1);
  assert.equal(result.baseItems[0].grams, 290);
  assert.ok(result.extraItems.length > 0);
  for (const key of ["kcal", "protein", "carbs", "fat", "fiber"] as const) {
    assert.ok(Math.abs(result.base[key] + result.extras[key] - generated.recipe.nutritionPerServing[key]) < .0001);
  }
  const original = structuredClone(generated.recipe);
  const chicken = original.ingredients.find((item) => item.ingredientId === "chicken")!;
  chicken.nutrients.kcal += 20;
  assert.equal(recipeMealBreakdown(original)!.base.kcal, result.base.kcal + 10);
  const allBase = structuredClone(generated.recipe);
  allBase.input.pantry = allBase.ingredients.map((item) => ({
    ingredientId: item.ingredientId, availableGrams: item.grams, mode: "fixed", dietGrams: item.grams / allBase.servings,
  }));
  assert.deepEqual(recipeMealBreakdown(allBase)!.extras, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  const classic = structuredClone(generated.recipe);
  classic.input.pantry = classic.input.pantry.map((item) => ({ ...item, mode: "available" }));
  assert.equal(recipeMealBreakdown(classic), null);
});
