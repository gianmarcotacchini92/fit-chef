import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { generateRecipe } from "../src/lib/engine";
import { createMealBase } from "../src/lib/meal";
import { retainRecipes } from "../src/lib/pantry";
import { GENERATION_HISTORY_LIMIT, historyMatchesMeal, selectGenerationHistory } from "../src/lib/recipe-history";
import { localStateSchema } from "../src/lib/validation";
import type { GenerateRequest, LocalState, Recipe, RecipeInput } from "../src/lib/types";

function poultryInput(): RecipeInput {
  return {
    ...structuredClone(DEFAULT_MEAL_INPUT),
    pantry: createMealBase([
      { ingredientId: "chicken", grams: 165 }, { ingredientId: "fennel", grams: 175 }, { ingredientId: "bread", grams: 62 },
    ], 1),
  };
}

async function recipe(request: GenerateRequest): Promise<Recipe> {
  const result = await generateRecipe(request);
  assert.equal(result.status, "ok", JSON.stringify(result));
  return result.recipe;
}

function withTime(value: Recipe, minute: number): Recipe {
  const copy = structuredClone(value);
  copy.createdAt = `2026-01-01T12:${String(minute).padStart(2, "0")}:00.000Z`;
  copy.fingerprint.createdAt = copy.createdAt;
  return copy;
}

test("same-meal history survives more than 30 newer recipes for unrelated meals", async () => {
  const input = poultryInput();
  const first = withTime(await recipe({ ...input, history: [], nonce: "history-first" }), 0);
  const second = withTime(await recipe({ ...input, history: [first.fingerprint], nonce: "history-second" }), 1);
  const dessertInput = structuredClone(DEFAULT_MEAL_INPUT);
  dessertInput.pantry = createMealBase([{ ingredientId: "greek-yogurt", grams: 180 }, { ingredientId: "banana", grams: 110 }], 1);
  dessertInput.preferences.taste = "sweet";
  const dessert = await recipe({ ...dessertInput, history: [], nonce: "history-dessert" });
  const unrelated = Array.from({ length: 40 }, (_, index) => ({
    ...withTime(dessert, index + 2), id: `unrelated-${index}`,
  }));
  const saved = [...unrelated.reverse(), second, first];
  const original = structuredClone(saved);
  const selected = selectGenerationHistory(saved, input);
  assert.equal(selected.length, GENERATION_HISTORY_LIMIT);
  assert.deepEqual(selected.slice(0, 2), [second.fingerprint, first.fingerprint]);
  assert.deepEqual(saved, original);
  const next = await recipe({ ...input, history: selected, nonce: "history-after-many-meals" });
  assert.notEqual(next.templateId, second.templateId);
});

for (const action of ["regenerate", "another"] as const) {
  test(`${action} keeps rotating after the library has already seen every preparation and is reloaded`, async () => {
    let state: LocalState = {
      version: 1, input: poultryInput(), recipes: [], favoriteIds: [], cookedIds: [],
    };
    let previous: Recipe | undefined;
    for (let index = 0; index < 8; index++) {
      const next = await recipe({
        ...state.input,
        nonce: "constant-nonce-proves-history-not-randomness",
        history: selectGenerationHistory(state.recipes, state.input),
        ...(action === "another" && previous ? { variant: {
          kind: "another" as const, baselineRecipeId: previous.id,
          baselineNutrition: previous.nutritionPerServing, baselineMinutes: previous.minutes,
        } } : {}),
      });
      if (previous) assert.notEqual(next.templateId, previous.templateId, `Consecutive repeat on generation ${index + 1}`);
      assert.deepEqual(next.input.pantry, state.input.pantry);
      if (index >= 2) assert.ok(next.warnings.some((warning) => /Ripetizione esplicita/.test(warning)));
      const saved = withTime(next, index);
      state.recipes = retainRecipes([saved, ...state.recipes.filter((entry) => entry.id !== saved.id)], state.favoriteIds);
      state = localStateSchema.parse(JSON.parse(JSON.stringify(state)));
      previous = saved;
    }
    assert.equal(state.recipes.length, 2, "Rotation must work with stable, deduplicated recipe IDs.");
  });
}

test("another excludes the recipe currently displayed, even when it is not the latest saved one", async () => {
  const input = poultryInput();
  const displayed = withTime(await recipe({ ...input, history: [], nonce: "displayed-old" }), 1);
  const newer = withTime(await recipe({ ...input, history: [displayed.fingerprint], nonce: "newer" }), 2);
  const next = await recipe({
    ...input, history: selectGenerationHistory([newer, displayed], input), nonce: "another-displayed",
    variant: { kind: "another", baselineRecipeId: displayed.id, baselineNutrition: displayed.nutritionPerServing, baselineMinutes: displayed.minutes },
  });
  assert.notEqual(next.templateId, displayed.templateId);
});

test("a single feasible preparation stays honest rather than changing grams or inventing alternatives", async () => {
  const input = poultryInput();
  input.preferences.maxTime = 25;
  const first = await recipe({ ...input, history: [], nonce: "only-one" });
  const next = await recipe({
    ...input, history: [first.fingerprint], nonce: "only-one-again",
    variant: { kind: "another", baselineRecipeId: first.id, baselineNutrition: first.nutritionPerServing, baselineMinutes: first.minutes },
  });
  assert.equal(next.id, first.id);
  assert.match(next.variantTip, /una sola preparazione/);
  assert.deepEqual(next.ingredients, first.ingredients);
});

test("related meal detection ignores optional extra changes but does not mix different base proteins", async () => {
  const input = poultryInput();
  const previous = await recipe({ ...input, history: [], nonce: "related-base" });
  const withExtra = { ...input, pantry: [...input.pantry, { ingredientId: "lemon", mode: "preferred" as const, availableGrams: 15, dietGrams: 15 }] };
  assert.equal(historyMatchesMeal(previous.fingerprint, withExtra), true);
  const otherBase = { ...input, pantry: createMealBase([{ ingredientId: "turkey", grams: 165 }, { ingredientId: "fennel", grams: 175 }, { ingredientId: "bread", grams: 62 }], 1) };
  assert.equal(historyMatchesMeal(previous.fingerprint, otherBase), false);
});
