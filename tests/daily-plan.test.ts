import assert from "node:assert/strict";
import test from "node:test";
import { adjustPlannedDay, applyDailyAdjustment, plannedDay } from "../src/lib/daily-plan";
import { emptyWeeklyDraft, initialWeeklyDietState, resolveWeeklyMeal, weeklyMealKey } from "../src/lib/weekly-diet";
import { syntheticWeeklyPlan } from "./fixtures/weekly-plan";
import type { WeeklyMeal, WeekMeal } from "../src/lib/types";

function fullySpecified() {
  const plan = syntheticWeeklyPlan();
  const make = (meal: WeekMeal): WeeklyMeal => ({
    original: `Pasto sintetico ${meal}`, taste: "savory",
    slots: [
      { id: "protein", label: "Pollo", options: [{ ingredientId: "chicken", grams: 100 }] },
      { id: "carb", label: "Riso", options: [{ ingredientId: "rice", grams: 100 }] },
    ],
  });
  for (const meal of ["breakfast", "lunch", "snack", "dinner"] as WeekMeal[]) plan.monday[meal] = make(meal);
  return { ...initialWeeklyDietState(), plan };
}

test("incomplete or free-choice days are never optimized as zero-calorie meals", () => {
  const state = { ...initialWeeklyDietState(), plan: syntheticWeeklyPlan() };
  const day = plannedDay(state, "monday");
  assert.ok(day.errors.length);
  assert.throws(() => adjustPlannedDay(day, 1800, 79), /pasto libero|quantifica/i);
});

test("day optimization meets kcal tolerance and 1.6g/kg and leaves imports unchanged", () => {
  const state = fullySpecified();
  const before = JSON.stringify(state.plan);
  const day = plannedDay(state, "monday");
  const result = adjustPlannedDay(day, 1930, 60);
  assert.equal(result.reached, true, result.message);
  assert.ok(Math.abs(result.kcal - 1930) <= 25);
  assert.ok(result.protein >= 96);
  const changed = applyDailyAdjustment(state, "monday", result);
  assert.equal(JSON.stringify(changed.plan), before);
  assert.equal(state.drafts["monday-lunch"], undefined);
  const draft = changed.drafts[weeklyMealKey("monday", "lunch")] ?? emptyWeeklyDraft();
  assert.equal(draft.confirmed, false);
  const resolved = resolveWeeklyMeal("monday", "lunch", { ...draft, confirmed: true }, changed.plan);
  assert.equal(resolved.errors.length, 0);
  assert.ok(resolved.items.some((item) => item.grams !== 100));
});

test("all locked quantities remain unchanged and incompatible target is clearly not reached", () => {
  const state = fullySpecified();
  const keys = new Set<string>();
  for (const meal of ["breakfast", "lunch", "snack", "dinner"]) {
    keys.add(`${meal}:protein-chicken`);
    keys.add(`${meal}:carb-rice`);
  }
  const day = plannedDay(state, "monday", keys);
  const result = adjustPlannedDay(day, 2200, 60);
  assert.equal(result.reached, false);
  assert.deepEqual(result.items.map((item) => item.grams), day.items.map((item) => item.grams));
  assert.throws(() => applyDailyAdjustment(state, "monday", result), /non soddisfa/i);
});
