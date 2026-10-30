import assert from "node:assert/strict";
import test from "node:test";
import { recipeFood } from "../src/components/recipe-builder";
import { catalogFood } from "../src/lib/nutrition-diary";
import { emptyWeeklyDraft, resolveWeeklyMeal, weeklyMealKey } from "../src/lib/weekly-diet";
import { plannedDay } from "../src/lib/daily-plan";
import { syntheticWeeklyPlan } from "./fixtures/weekly-plan";

test("homemade recipe uses actual ingredients and final weighed yield", () => {
  const recipe = recipeFood({ name: "Pancake casalinghi", ingredients: [
    { food: catalogFood("wheat-flour"), grams: 100 },
    { food: catalogFood("eggs"), grams: 100 },
  ], yieldGrams: 200 });
  assert.equal(recipe.name, "Pancake casalinghi");
  assert.equal(recipe.per100g.kcal, 243);
  assert.equal(recipe.per100g.protein, 11.8);
  assert.throws(() => recipeFood({ name: "Test", ingredients: [{ food: catalogFood("eggs"), grams: 50 }], yieldGrams: 0 }));
});

test("private recipe can replace a planned pancake without changing imported diet", () => {
  const recipe = recipeFood({ name: "Pancake reali", ingredients: [{ food: catalogFood("wheat-flour"), grams: 100 }], yieldGrams: 200 });
  const plan = syntheticWeeklyPlan();
  const original = JSON.stringify(plan);
  const state = { version: 1 as const, day: "wednesday" as const, meal: "breakfast" as const,
    drafts: { [weeklyMealKey("wednesday", "breakfast")]: {
      ...emptyWeeklyDraft(), confirmed: true,
      customFoods: { "ready-pancakes": recipe.id },
      grams: { [`ready-pancakes-${recipe.id}`]: "80", "coffee-coffee": "50" },
    } }, plan };
  const result = resolveWeeklyMeal("wednesday", "breakfast", state.drafts["wednesday-breakfast"], plan, [recipe]);
  assert.ok(result.items.some(item => item.food?.id === recipe.id && item.grams === 80));
  assert.equal(JSON.stringify(plan), original);
  const day = plannedDay(state, "wednesday", new Set(), [recipe]);
  assert.ok(day.items.some(item => item.ingredientId === recipe.id));
});
