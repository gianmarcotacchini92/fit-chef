import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { emptyNutritionState, nutritionStateSchema, targetsOnDate } from "../src/lib/nutrition-state";
import { catalogFood, type DiaryEntry } from "../src/lib/nutrition-diary";
import { mergeCloudWorkspaces } from "../src/lib/cloud-merge";
import { parseCloudWorkspace } from "../src/lib/cloud";
import { localStateSchema } from "../src/lib/validation";
import { syntheticWeeklyPlan } from "./fixtures/weekly-plan";
import { initialWeeklyDietState } from "../src/lib/weekly-diet";
import type { LocalState } from "../src/lib/types";
import type { BodyProfile } from "../src/lib/nutrition-profile";

const workspace = (): LocalState => ({
  version: 1, input: structuredClone(DEFAULT_MEAL_INPUT), recipes: [], favoriteIds: [], cookedIds: [],
  weeklyDiet: { ...initialWeeklyDietState(), plan: syntheticWeeklyPlan() },
});
const entry = (): DiaryEntry => ({
  id: crypto.randomUUID(), date: "2026-10-06", createdAt: "2026-10-06T09:00:00.000Z",
  food: catalogFood("pasta"), grams: 85, meal: "lunch",
});
const profile: BodyProfile = {
  age: 34, sex: "male", heightCm: 180, weightKg: 80, bodyFatPercent: 20, leanMassKg: 64,
  visceralFat: 8, measuredBmr: null, bmrMethod: "mifflin", activity: 1.55, goal: "maintain", adjustmentPercent: 0,
};
const targets = { kcal: 2400, protein: 140, carbs: 300, fat: 70 };

test("legacy workspace validates without fabricating a body profile or dropping the private plan", () => {
  const legacy = workspace();
  const parsed = localStateSchema.parse(legacy);
  assert.equal(parsed.nutrition, undefined);
  assert.deepEqual(parsed.weeklyDiet?.plan, legacy.weeklyDiet?.plan);
});

test("nutrition and the legacy plan roundtrip intact through cloud and local JSON", () => {
  const state = { ...workspace(), nutrition: { ...emptyNutritionState(), entries: [entry()], profile, targets } };
  assert.deepEqual(parseCloudWorkspace(JSON.parse(JSON.stringify(state))), state);
  assert.deepEqual(localStateSchema.parse(state), state);
});

test("nutrition identifiers, quantities, and profile confirmation are validated", () => {
  const base = emptyNutritionState(), first = entry();
  assert.equal(nutritionStateSchema.safeParse({ ...base, entries: [first, first] }).success, false);
  assert.equal(nutritionStateSchema.safeParse({ ...base, entries: [{ ...first, grams: 0 }] }).success, false);
  assert.equal(nutritionStateSchema.safeParse({ ...base, profile }).success, false);
  assert.equal(nutritionStateSchema.safeParse({ ...base, targets }).success, false);
});

test("two devices can independently add diary entries and saved meals without overwriting each other", () => {
  const base = { ...workspace(), nutrition: emptyNutritionState() };
  const local = structuredClone(base), remote = structuredClone(base);
  local.nutrition.entries.push(entry());
  remote.nutrition.entries.push({ ...entry(), food: catalogFood("rice"), grams: 75 });
  local.nutrition.savedMeals.push({ id: crypto.randomUUID(), name: "Pasto A", createdAt: entry().createdAt, items: [{ food: catalogFood("pasta"), grams: 85 }] });
  remote.nutrition.savedMeals.push({ id: crypto.randomUUID(), name: "Pasto B", createdAt: entry().createdAt, items: [{ food: catalogFood("rice"), grams: 75 }] });
  const merged = mergeCloudWorkspaces(base, local, remote);
  assert.ok(merged.state?.nutrition);
  assert.equal(merged.state.nutrition.entries.length, 2);
  assert.equal(merged.state.nutrition.savedMeals.length, 2);
  assert.deepEqual(merged.state.weeklyDiet?.plan, base.weeklyDiet?.plan);
});

test("independent first diary writes merge even when the baseline predates the calorie tracker", () => {
  const base = workspace();
  const local = { ...structuredClone(base), nutrition: { ...emptyNutritionState(), entries: [entry()] } };
  const remote = { ...structuredClone(base), nutrition: { ...emptyNutritionState(), entries: [entry()] } };
  const merged = mergeCloudWorkspaces(base, local, remote);
  assert.ok(merged.state?.nutrition);
  assert.equal(merged.state.nutrition.entries.length, 2);
  assert.deepEqual(merged.conflicts, []);
});

test("concurrent target changes pause rather than silently selecting an objective", () => {
  const base = { ...workspace(), nutrition: { ...emptyNutritionState(), profile, targets } };
  const local = structuredClone(base), remote = structuredClone(base);
  local.nutrition.targets.kcal = 2300;
  remote.nutrition.targets.kcal = 2600;
  const merged = mergeCloudWorkspaces(base, local, remote);
  assert.equal(merged.state, undefined);
  assert.ok(merged.conflicts.includes("nutrition.targets.kcal"));
});

test("diary deletions merge, but deletion versus concurrent edit remains an explicit conflict", () => {
  const first = entry(), second = { ...entry(), food: catalogFood("rice") };
  const base = { ...workspace(), nutrition: { ...emptyNutritionState(), entries: [first, second] } };
  const local = structuredClone(base), remote = structuredClone(base);
  local.nutrition.entries = [second];
  remote.nutrition.entries[1].grams = 100;
  const merged = mergeCloudWorkspaces(base, local, remote);
  assert.equal(merged.state?.nutrition?.entries.length, 1);
  assert.equal(merged.state?.nutrition?.entries[0].grams, 100);
  remote.nutrition.entries[0].grams = 50;
  const conflict = mergeCloudWorkspaces(base, local, remote);
  assert.equal(conflict.state, undefined);
  assert.ok(conflict.conflicts.length > 0);
});

test("targets follow confirmed measurement dates, not retroactive application of today's target", () => {
  const state = {
    ...emptyNutritionState(), profile, targets,
    checkIns: [
      { id: crypto.randomUUID(), date: "2026-10-06", createdAt: "2026-10-06T09:00:00.000Z", profile, targets },
      { id: crypto.randomUUID(), date: "2026-10-08", createdAt: "2026-10-08T09:00:00.000Z", profile, targets: { ...targets, kcal: 2500 } },
    ],
  };
  assert.equal(targetsOnDate(state, "2026-10-05"), undefined);
  assert.deepEqual(targetsOnDate(state, "2026-10-07"), targets);
  assert.equal(targetsOnDate(state, "2026-10-09")?.kcal, 2500);
});
