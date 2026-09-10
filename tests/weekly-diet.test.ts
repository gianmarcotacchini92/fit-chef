import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { confirmMealExtra } from "../src/lib/meal";
import { localStateSchema, weeklyPlanSchema } from "../src/lib/validation";
import { parseCloudWorkspace } from "../src/lib/cloud";
import {
  applyWeeklyMeal, emptyWeeklyDraft, initialWeeklyDietState, migrateWeeklyPlan, parseWeeklyPlanJson,
  replaceWeeklyPlan, resolveWeeklyMeal, selectedWeeklyOption, WEEK_DAYS, WEEK_MEALS,
  weeklyMealIsApplied, weeklyMealKey, weeklyQuantityKey, weeklySuggestedMinutes,
} from "../src/lib/weekly-diet";
import { GET } from "../src/app/api/weekly-diet/route";
import type { LocalState, WeeklyDietState } from "../src/lib/types";
import { syntheticWeeklyPlan } from "./fixtures/weekly-plan";

const plan = syntheticWeeklyPlan();
function confirmed(): WeeklyDietState {
  return { ...initialWeeklyDietState(), plan: structuredClone(plan), day: "thursday", drafts: {
    "thursday-lunch": { choices: {}, grams: { "tomato-tomato": "123" }, confirmed: true },
  } };
}

test("public default contains no personal plan and cannot resolve, apply or confirm a meal", () => {
  const state = initialWeeklyDietState();
  assert.equal(state.plan, undefined);
  assert.deepEqual(state.drafts, {});
  const resolved = resolveWeeklyMeal(state.day, state.meal, emptyWeeklyDraft());
  assert.deepEqual(resolved.items, []);
  assert.match(resolved.errors[0], /Importa/);
  assert.equal(applyWeeklyMeal(state, DEFAULT_MEAL_INPUT).input, undefined);
  assert.equal(weeklyMealIsApplied({ ...state, appliedKey: "monday-lunch" }, DEFAULT_MEAL_INPUT), false);
});

test("synthetic calendar retains all 28 cells, explicit free choices, alternatives and timing", () => {
  const meals = WEEK_DAYS.flatMap((day) => WEEK_MEALS.map((meal) => plan[day.id][meal.id]));
  assert.equal(meals.length, 28);
  assert.equal(meals.filter((entry) => entry.freeChoice).length, 12);
  assert.equal(plan.thursday.lunch.original, "Pasta di prova: 64 g pasta e 46 g formaggio spalmabile");
  assert.equal(weeklySuggestedMinutes(plan.wednesday.lunch, 1), 55);
  assert.equal(weeklySuggestedMinutes(plan.wednesday.lunch, 2), 59);
  assert.equal(weeklySuggestedMinutes(plan.thursday.lunch, 1), undefined);
  assert.equal(plan.tuesday.snack.slots[1].options[0].grams, 24);
  assert.equal(plan.wednesday.snack.slots[1].options[0].grams, null);
});

test("missing quantities and piece counts stay unresolved rather than inventing weight", () => {
  for (const slot of [plan.wednesday.breakfast.slots[1], plan.tuesday.breakfast.slots[3], plan.tuesday.lunch.slots[2], plan.monday.breakfast.slots[1]]) {
    assert.equal(slot.options[0].grams, null);
  }
  assert.equal(selectedWeeklyOption(plan.tuesday.snack.slots[0], emptyWeeklyDraft()), undefined);
  const result = resolveWeeklyMeal("thursday", "lunch", emptyWeeklyDraft(), plan);
  assert.ok(result.errors.some((error) => error.startsWith("Pomodori di prova:")));
  assert.ok(result.errors.some((error) => error.startsWith("Conferma")));
  assert.deepEqual(result.items, [{ ingredientId: "pasta", grams: 64 }, { ingredientId: "cream-cheese", grams: 46 }]);
  for (const grams of ["", "-1", "0", "5001", "NaN", "Infinity"]) {
    assert.ok(resolveWeeklyMeal("thursday", "lunch", {
      choices: {}, grams: { "tomato-tomato": grams }, confirmed: true,
    }, plan).errors.length > 0, grams);
  }
  assert.equal(resolveWeeklyMeal("thursday", "lunch", {
    choices: {}, grams: { "tomato-tomato": "123,5" }, confirmed: true,
  }, plan).items[0].grams, 123.5);
});

test("fixed grams cannot be overwritten; application keeps targets, preferences and multi-serving amounts", () => {
  const state = confirmed();
  state.drafts["thursday-lunch"].grams["pasta-pasta"] = "1";
  const input = structuredClone(DEFAULT_MEAL_INPUT);
  input.preferences.servings = 2;
  input.targets.kcal = 410;
  input.targets.strictCalories = true;
  input.preferences.allergens = ["peanuts"];
  const snapshot = structuredClone(input);
  const result = applyWeeklyMeal(state, input);
  assert.deepEqual(result.errors, []);
  assert.ok(result.input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(result.input.targets, input.targets);
  assert.deepEqual(result.input.preferences.allergens, ["peanuts"]);
  assert.deepEqual(result.input.pantry.find((item) => item.ingredientId === "pasta"), { ingredientId: "pasta", mode: "fixed", dietGrams: 64, availableGrams: 128 });
  assert.deepEqual(result.input.pantry.find((item) => item.ingredientId === "cream-cheese"), { ingredientId: "cream-cheese", mode: "fixed", dietGrams: 46, availableGrams: 92 });
  assert.ok(result.input.pantry.every((item) => item.mode === "fixed"));
});

test("alternatives remain opt-in and preserve distinct quantities", () => {
  const slot = plan.thursday.dinner.slots[2];
  assert.equal(selectedWeeklyOption(slot, emptyWeeklyDraft()), undefined);
  assert.deepEqual(selectedWeeklyOption(slot, { ...emptyWeeklyDraft(), choices: { cheese: "mozzarella" } }), { ingredientId: "mozzarella", grams: 135 });
  assert.deepEqual(selectedWeeklyOption(slot, { ...emptyWeeklyDraft(), choices: { cheese: "caciotta" } }), { ingredientId: "caciotta", grams: 92 });
  assert.equal(selectedWeeklyOption(slot, { ...emptyWeeklyDraft(), choices: { cheese: "mozzarella-light" } }), undefined);
  assert.deepEqual(plan.friday.dinner.slots[2].options.map((option) => option.grams), [175, 225]);
  assert.deepEqual(plan.friday.lunch.slots[2].options.map((option) => option.grams), [145, 145]);
});

test("confirmation detects changed day, quantities or missing stock but allows explicitly confirmed extras", () => {
  const state = confirmed();
  const result = applyWeeklyMeal(state, structuredClone(DEFAULT_MEAL_INPUT));
  assert.ok(result.input);
  assert.equal(weeklyMealIsApplied(state, result.input), false);
  state.appliedKey = "thursday-lunch";
  assert.equal(weeklyMealIsApplied(state, result.input), true);
  const extra = { ...result.input, pantry: confirmMealExtra(result.input.pantry, "olive-oil", 5, 1, true) };
  assert.equal(weeklyMealIsApplied(state, extra), true);
  assert.equal(weeklyMealIsApplied({ ...state, day: "tuesday" }, result.input), false);
  const changed = structuredClone(result.input);
  changed.pantry[0].dietGrams = 99;
  assert.equal(weeklyMealIsApplied(state, changed), false);
  const servings = structuredClone(result.input);
  servings.preferences.servings = 2;
  assert.equal(weeklyMealIsApplied(state, servings), false);
  state.drafts["thursday-lunch"].confirmed = false;
  assert.equal(weeklyMealIsApplied(state, result.input), false);
});

test("allergies surface, unconfirmed extras disappear, and free choices cannot reuse stale ingredients", () => {
  const input = structuredClone(DEFAULT_MEAL_INPUT);
  input.preferences.allergens = ["milk"];
  const blocked = applyWeeklyMeal(confirmed(), input);
  assert.equal(blocked.input, undefined);
  assert.ok(blocked.errors.some((error) => /allergene/.test(error)));
  input.preferences.allergens = [];
  input.pantry = [{ ingredientId: "olive-oil", availableGrams: 10, mode: "preferred", dietGrams: 10 }];
  const result = applyWeeklyMeal(confirmed(), input);
  assert.ok(result.input);
  assert.equal(result.input.pantry.some((item) => item.ingredientId === "olive-oil"), false);
  const free = applyWeeklyMeal({ ...confirmed(), day: "monday", meal: "lunch" }, result.input);
  assert.equal(free.input, undefined);
  assert.match(free.errors[0], /a piacere/);
});

test("plan, selection and drafts round-trip through local/cloud schemas; old workspaces stay valid", () => {
  const old: LocalState = { version: 1, input: structuredClone(DEFAULT_MEAL_INPUT), recipes: [], favoriteIds: [], cookedIds: [] };
  assert.deepEqual(localStateSchema.parse(old), old);
  const legacy = { ...old, weeklyDiet: initialWeeklyDietState() };
  assert.deepEqual(localStateSchema.parse(legacy), legacy);
  const current = { ...old, weeklyDiet: confirmed(), builderMode: "weekly" };
  assert.deepEqual(localStateSchema.parse(JSON.parse(JSON.stringify(current))), current);
  assert.deepEqual(parseCloudWorkspace(current), current);
  assert.equal(localStateSchema.safeParse({ ...current, weeklyDiet: { ...confirmed(), day: "not-a-day" } }).success, false);
  assert.equal(localStateSchema.safeParse({ ...current, weeklyDiet: { ...confirmed(), drafts: { "eighth-day-lunch": emptyWeeklyDraft() } } }).success, false);
  assert.equal(localStateSchema.safeParse({ ...current, builderMode: "unknown" }).success, false);
  assert.equal(localStateSchema.safeParse({ ...current, secretExtraField: true }).success, false);
  assert.equal(weeklyMealKey("wednesday", "snack"), "wednesday-snack");
});

test("every synthetic non-free meal resolves only explicitly chosen options and measured weights", () => {
  for (const day of WEEK_DAYS) for (const meal of WEEK_MEALS) {
    const current = plan[day.id][meal.id];
    if (current.freeChoice) continue;
    const draft = emptyWeeklyDraft();
    for (const slot of current.slots) {
      const option = slot.options[0];
      draft.choices[slot.id] = option.ingredientId;
      if (option.grams === null) draft.grams[weeklyQuantityKey(slot, option)] = "113";
    }
    draft.confirmed = true;
    const resolved = resolveWeeklyMeal(day.id, meal.id, draft, plan);
    assert.deepEqual(resolved.errors, [], `${day.id}/${meal.id}`);
    assert.equal(resolved.items.length, current.slots.length);
    const state: WeeklyDietState = { version: 1, day: day.id, meal: meal.id, plan, drafts: { [weeklyMealKey(day.id, meal.id)]: draft } };
    const result = applyWeeklyMeal(state, structuredClone(DEFAULT_MEAL_INPUT));
    assert.deepEqual(result.errors, [], `${day.id}/${meal.id}`);
    assert.ok(result.input);
    assert.equal(result.input.preferences.meal, meal.id);
    assert.equal(result.input.preferences.taste, current.taste);
  }
});

test("plan schema is strict, complete, bounded and rejects ambiguous structures", () => {
  assert.deepEqual(weeklyPlanSchema.parse(plan), plan);
  const invalid: unknown[] = [
    { ...plan, monday: undefined }, { ...plan, extraDay: plan.monday },
    { ...plan, monday: { ...plan.monday, breakfast: undefined } },
    { ...plan, monday: { ...plan.monday, dessert: plan.monday.breakfast } },
  ];
  for (const mutate of [
    (meal: typeof plan.thursday.lunch) => { meal.slots = []; },
    (meal: typeof plan.thursday.lunch) => { meal.freeChoice = true; },
    (meal: typeof plan.thursday.lunch) => { meal.slots.push(structuredClone(meal.slots[0])); },
    (meal: typeof plan.thursday.lunch) => { meal.slots[0].options.push(structuredClone(meal.slots[0].options[0])); },
    (meal: typeof plan.thursday.lunch) => { meal.slots[0].options = []; },
    (meal: typeof plan.thursday.lunch) => { meal.slots = [
      { id: "x-brown", label: "Riso di prova", options: [{ ingredientId: "rice", grams: null }] },
      { id: "x", label: "Riso integrale di prova", options: [{ ingredientId: "brown-rice", grams: null }] },
    ]; },
    (meal: typeof plan.thursday.lunch) => { meal.slots[0].id = "../bad"; },
    (meal: typeof plan.thursday.lunch) => { meal.slots[0].options[0].ingredientId = "unsafe/id"; },
    (meal: typeof plan.thursday.lunch) => { meal.original = "x".repeat(3001); },
    (meal: typeof plan.thursday.lunch) => { meal.original = "\u0000"; },
    (meal: typeof plan.thursday.lunch) => { meal.slots[0].label = ""; },
    (meal: typeof plan.thursday.lunch) => { meal.suggestedMaxTime = 241; },
    ...[0, -1, 5001, Infinity, NaN].map((grams) => (meal: typeof plan.thursday.lunch) => { meal.slots[0].options[0].grams = grams; }),
  ]) {
    const changed = structuredClone(plan);
    mutate(changed.thursday.lunch);
    invalid.push(changed);
  }
  for (const value of invalid) assert.equal(weeklyPlanSchema.safeParse(value).success, false);
  const unknown = structuredClone(plan);
  unknown.thursday.lunch.slots[0].options[0].ingredientId = "not-in-catalog";
  assert.equal(weeklyPlanSchema.safeParse(unknown).success, true);
  assert.match(resolveWeeklyMeal("thursday", "lunch", emptyWeeklyDraft(), unknown).errors[0], /catalogo/);
});

test("plan imports are validated, explicit replacement clears drafts, local migration preserves only legacy state", () => {
  assert.deepEqual(parseWeeklyPlanJson(JSON.stringify(plan)), plan);
  for (const contents of ["{", "null", "{}", JSON.stringify({ plan }), " ".repeat(512 * 1024 + 1)]) {
    assert.throws(() => parseWeeklyPlanJson(contents));
  }
  const state = { ...confirmed(), appliedKey: "thursday-lunch" };
  const snapshot = structuredClone(state);
  const replaced = replaceWeeklyPlan(state, plan);
  assert.deepEqual(state, snapshot);
  assert.deepEqual(replaced.drafts, {});
  assert.equal(replaced.appliedKey, undefined);
  assert.equal(replaced.day, state.day);
  const legacy = { ...state, plan: undefined };
  const migrated = migrateWeeklyPlan(legacy, plan);
  assert.deepEqual(migrated.drafts, legacy.drafts);
  assert.equal(migrated.appliedKey, legacy.appliedKey);
  assert.deepEqual(migrated.plan, plan);
  assert.equal(migrateWeeklyPlan(state, syntheticWeeklyPlan()), state);
});

test("imported long slot IDs remain persistable and overlapping selected foods fail safely", () => {
  const current = confirmed();
  const slot = current.plan!.thursday.lunch.slots[0];
  slot.id = "x".repeat(100);
  const key = weeklyQuantityKey(slot, slot.options[0]);
  current.drafts["thursday-lunch"].grams = { [key]: "123" };
  const workspace: LocalState = { version: 1, input: DEFAULT_MEAL_INPUT, recipes: [], favoriteIds: [], cookedIds: [], weeklyDiet: current };
  assert.deepEqual(localStateSchema.parse(workspace), workspace);
  current.plan!.thursday.lunch.slots.push({ id: "duplicate-food", label: "Voce duplicata", options: [{ ingredientId: "pasta", grams: 12 }] });
  const result = applyWeeklyMeal(current, DEFAULT_MEAL_INPUT);
  assert.equal(result.input, undefined);
  assert.match(result.errors[0], /alimento gia presente/);
});

test("migration endpoint reads only its named private file, validates it and never caches", async (t) => {
  const read = t.mock.method(fs, "readFile", async (path: unknown) => {
    assert.equal(String(path).replaceAll("\\", "/"), `${process.cwd().replaceAll("\\", "/")}/.data/weekly-diet-import.json`);
    return JSON.stringify(plan);
  });
  const response = await GET(new Request("http://localhost:3000/api/weekly-diet?file=ignored.json"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { plan });
  assert.equal(read.mock.callCount(), 1);
});

test("migration endpoint rejects remote and cross-site reads before filesystem access", async (t) => {
  const read = t.mock.method(fs, "readFile", async () => { throw new Error("Must not read"); });
  for (const request of [
    new Request("https://example.com/api/weekly-diet"),
    new Request("http://localhost:3000/api/weekly-diet", { headers: { origin: "https://example.com" } }),
    new Request("http://localhost:3000/api/weekly-diet", { headers: { "sec-fetch-site": "cross-site" } }),
  ]) assert.equal((await GET(request)).status, 403);
  assert.equal(read.mock.callCount(), 0);
});

test("migration reports null only for ENOENT and surfaces permission, JSON and schema failures", async (t) => {
  let mode = "ENOENT";
  t.mock.method(fs, "readFile", async () => {
    if (mode === "json") return "{";
    if (mode === "schema") return "{}";
    throw Object.assign(new Error("Sensitive contents must never be logged"), { code: mode });
  });
  t.mock.method(console, "error", () => undefined);
  const request = () => new Request("http://localhost:3000/api/weekly-diet");
  const missing = await GET(request());
  assert.equal(missing.status, 200);
  assert.deepEqual(await missing.json(), { plan: null });
  for (mode of ["EACCES", "EIO", "json", "schema"]) {
    const response = await GET(request());
    assert.equal(response.status, 500, mode);
    assert.equal((await response.json()).plan, undefined);
  }
});
