import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_VERSION, INGREDIENTS, getIngredient } from "../src/lib/catalog";
import { DEFAULT_INPUT, DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { calculateNutrition, generateRecipe } from "../src/lib/engine";
import { formatGrams } from "../src/lib/engine-steps";
import { buildTitle } from "../src/lib/engine-titles";
import { TEMPLATES } from "../src/lib/templates";
import { createMealBase, recipeMealBreakdown } from "../src/lib/meal";
import type { GenerateRequest, Nutrients, PantryItem, Recipe, RecipeFingerprint } from "../src/lib/types";

const unset = (): GenerateRequest["targets"] => ({
  kcal: null, protein: null, carbs: null, fat: null, fiber: null, strictCalories: false,
});
function request(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return { ...structuredClone(DEFAULT_INPUT), history: [], nonce: "test-stable", ...overrides };
}
function pantry(...ids: string[]): PantryItem[] {
  return ids.map((ingredientId) => ({ ingredientId, availableGrams: 1000, mode: "available" }));
}
async function recipe(input: GenerateRequest): Promise<Recipe> {
  const response = await generateRecipe(input);
  assert.equal(response.status, "ok", JSON.stringify(response));
  return response.recipe;
}
function close(actual: number, expected: number, epsilon = 1e-5): void {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
}
function checkIntegrity(result: Recipe, input: GenerateRequest): void {
  assert.deepEqual(result.input, {
    pantry: input.pantry, targets: input.targets, preferences: input.preferences,
  });
  assert.deepEqual(result.nutritionTotal, calculateNutrition(result.ingredients));
  for (const key of ["kcal", "protein", "carbs", "fat", "fiber"] as const) {
    close(result.nutritionPerServing[key] * result.servings, result.nutritionTotal[key]);
  }
  const allSteps = result.steps.map((step) => step.instruction).join("\n");
  if (/7[14] °C|termometro alimentare/.test(allSteps)) {
    assert.ok(input.preferences.equipment.includes("thermometer"), "Undeclared thermometer required by instructions");
  }
  for (const item of result.ingredients) {
    const stock = input.pantry.find((entry) => entry.ingredientId === item.ingredientId);
    assert.ok(stock, `Ingredient added outside pantry: ${item.ingredientId}`);
    assert.ok(item.grams > 0 && item.grams <= stock.availableGrams + 1e-6);
    assert.deepEqual(item.nutrients, calculateNutrition([item]));
    assert.equal(item.state, getIngredient(item.ingredientId)!.state);
    assert.ok(allSteps.includes(`${formatGrams(item.grams)} di ${item.name}`), `Missing quantity: ${item.name}`);
    assert.ok(result.steps.slice(1).some((step) => step.instruction.includes(`${formatGrams(item.grams)} di ${item.name}`)), `Ingredient only listed, never used: ${item.name}`);
  }
  assert.equal(new Set(result.ingredients.map((item) => item.ingredientId)).size, result.ingredients.length);
  assert.equal(result.minutes, result.steps.reduce((sum, step) => sum + step.minutes, 0));
  assert.ok(result.minutes <= input.preferences.maxTime);
  const template = TEMPLATES.find((entry) => entry.id === result.templateId)!;
  assert.ok(template.equipment.every((tool) => input.preferences.equipment.includes(tool)));
  assert.equal(result.fit.caloricDensity, null);
  assert.equal(result.fit.estimatedCookedWeightGrams, null);
  close(result.fit.proteinEnergyPercentage, result.nutritionPerServing.protein * 400 / result.nutritionPerServing.kcal);
  assert.match(result.planHash, /^[a-f0-9]{64}$/);
  assert.equal(result.sourceMode, "editorial");
  assert.ok(result.warnings.some((warning) => warning.includes("densità")));
}

test("catalog is curated, unique, explicit about source, state and available carbs", () => {
  assert.ok(INGREDIENTS.length >= 65 && INGREDIENTS.length <= 85);
  assert.equal(new Set(INGREDIENTS.map((item) => item.id)).size, INGREDIENTS.length);
  assert.match(CATALOG_VERSION, /^fit-chef-generic-\d{4}-\d{2}-\d{2}-v\d+$/);
  for (const food of INGREDIENTS) {
    assert.ok(food.state.length > 3 && food.source.includes("Stima editoriale generica"));
    assert.ok(Object.values(food.nutrients).every((value) => Number.isFinite(value) && value >= 0));
    assert.ok(food.addedSugar === null || food.addedSugar <= food.nutrients.carbs);
  }
  assert.deepEqual(getIngredient("oats")!.allergens, ["gluten"]);
  assert.deepEqual(getIngredient("whey")!.allergens, ["milk"]);
  assert.deepEqual(getIngredient("eggs")!.allergens, ["eggs"]);
  assert.deepEqual(getIngredient("tuna")!.allergens, ["fish"]);
  assert.deepEqual(getIngredient("tofu")!.allergens, ["soy"]);
  assert.deepEqual(getIngredient("peanut-butter")!.allergens, ["peanuts"]);
  assert.deepEqual(getIngredient("sesame")!.allergens, ["sesame"]);
  assert.equal(getIngredient("whey")!.addedSugar, null);
  assert.equal(getIngredient("whole-wheat-wrap")!.addedSugar, null);
  assert.equal(getIngredient("chicken")!.vegetarian, false);
  assert.equal(getIngredient("tofu")!.vegetarian, true);
  assert.equal(getIngredient("missing"), undefined);
});

test("nutrient math uses edible-state weight, available carbs, and separate fibre", () => {
  const result = calculateNutrition([{ ingredientId: "oats", grams: 50 }, { ingredientId: "banana", grams: 120 }]);
  close(result.kcal, 187.5 + 106.8);
  close(result.protein, 6.5 + 1.32);
  close(result.carbs, 29.5 + 24.24);
  close(result.fat, 3.5 + 0.36);
  close(result.fiber, 5 + 3.12);
  assert.deepEqual(calculateNutrition([]), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  assert.throws(() => calculateNutrition([{ ingredientId: "invented-food", grams: 100 }]), /sconosciuto/);
  assert.throws(() => calculateNutrition([{ ingredientId: "rice", grams: -1 }]), /Quantità/);
  assert.throws(() => calculateNutrition([{ ingredientId: "rice", grams: NaN }]), /Quantità/);
});

test("default pantry matches all FIT targets with honest output and complete instructions", async () => {
  const input = request();
  const result = await recipe(input);
  checkIntegrity(result, input);
  assert.equal(result.targetStatus, "matched");
  assert.ok(Math.abs(result.nutritionPerServing.kcal - 500) <= 25);
  assert.ok(Math.abs(result.nutritionPerServing.protein - 40) <= 4);
  assert.ok(Math.abs(result.nutritionPerServing.carbs - 50) <= 5);
  assert.ok(Math.abs(result.nutritionPerServing.fat - 14) <= 2);
  assert.match(result.steps.map((step) => step.instruction).join(" "), /74 °C/);
  assert.ok(result.substitutions.every((item) => getIngredient(item.replacementId)));
  assert.ok(result.substitutions.filter((item) => !input.pantry.some((food) => food.ingredientId === item.replacementId)).every((item) => item.description.includes("Da acquistare")));
});

test("optimizer is deterministic for identical inputs, without mutating inputs", async () => {
  const input = request();
  const original = structuredClone(input);
  const first = await recipe(input), second = await recipe(input);
  assert.deepEqual(input, original);
  assert.equal(first.planHash, second.planHash);
  assert.equal(first.id, second.id);
  assert.deepEqual(first.ingredients, second.ingredients);
  assert.deepEqual(first.steps, second.steps);
});

test("default pantry yields two genuinely distinct preparations, then warns on repeats", async () => {
  const first = await recipe(request());
  const second = await recipe(request({ history: [first.fingerprint], nonce: "second" }));
  assert.notEqual(first.templateId, second.templateId);
  assert.notEqual(first.technique, second.technique);
  assert.notEqual(first.fingerprint.signature, second.fingerprint.signature);
  assert.equal(second.targetStatus, "matched");
  const third = await recipe(request({ history: [first.fingerprint, second.fingerprint], nonce: "third" }));
  assert.ok(third.warnings.some((warning) => /Ripetizione esplicita/.test(warning)));
  assert.ok([first.templateId, second.templateId].includes(third.templateId));
});

test("history excludes only latest 20 exact structures, not old ones", async () => {
  const base = await recipe(request());
  const old: RecipeFingerprint = { ...base.fingerprint, createdAt: "2000-01-01T00:00:00Z" };
  const unrelated = Array.from({ length: 20 }, (_, index): RecipeFingerprint => ({
    ...base.fingerprint, signature: `other-${index}`, structuralSignature: `other-structure-${index}`,
    templateId: "not-a-template", ingredientIds: ["apple"], createdAt: `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  const result = await recipe(request({ history: [old, ...unrelated] }));
  assert.equal(result.planHash, base.planHash);
  assert.ok(!result.warnings.some((warning) => warning.includes("Ripetizione esplicita")));
});

test("per-serving fixed diet quantities consume total stock across servings", async () => {
  const input = request({
    targets: unset(),
    pantry: [
      { ingredientId: "chicken", availableGrams: 250, mode: "fixed", dietGrams: 112.5 },
      { ingredientId: "rice", availableGrams: 110, mode: "fixed", dietGrams: 50 },
      { ingredientId: "zucchini", availableGrams: 300, mode: "fixed", dietGrams: 140 },
    ],
    preferences: { ...DEFAULT_INPUT.preferences, servings: 2, maxTime: 40 },
  });
  const result = await recipe(input);
  checkIntegrity(result, input);
  assert.equal(result.ingredients.find((item) => item.ingredientId === "chicken")!.grams, 225);
  assert.equal(result.ingredients.find((item) => item.ingredientId === "rice")!.grams, 100);
  assert.equal(result.ingredients.find((item) => item.ingredientId === "zucchini")!.grams, 280);
});

test("scaling does not duplicate pantry inventory", async () => {
  const input = request({
    targets: unset(),
    preferences: { ...DEFAULT_INPUT.preferences, servings: 2, maxTime: 40 },
  });
  const result = await recipe(input);
  checkIntegrity(result, input);
  assert.ok(result.nutritionPerServing.kcal < 500);
});

test("fixed diet exceeding total inventory returns infeasible with exact conflict", async () => {
  const response = await generateRecipe(request({
    pantry: [{ ingredientId: "chicken", availableGrams: 200, mode: "fixed", dietGrams: 120 }],
    preferences: { ...DEFAULT_INPUT.preferences, servings: 2 },
  }));
  assert.equal(response.status, "infeasible");
  assert.match(response.details.join(" "), /240 g totali/);
});

test("fixed zero, missing, or negative diet quantities need input", async () => {
  for (const dietGrams of [undefined, 0, -10, NaN]) {
    const response = await generateRecipe(request({
      pantry: [{ ingredientId: "rice", availableGrams: 100, mode: "fixed", dietGrams }],
    }));
    assert.equal(response.status, "needs_input");
  }
});

test("strict calorie maximum is hard, including when the closest result misses soft targets", async () => {
  const input = request({ targets: { ...DEFAULT_INPUT.targets, kcal: 400, strictCalories: true } });
  const result = await recipe(input);
  assert.ok(result.nutritionPerServing.kcal <= 400);
  assert.equal(result.targetStatus, "closest");
  const impossible = await generateRecipe(request({
    targets: { ...unset(), kcal: 50, strictCalories: true },
  }));
  assert.equal(impossible.status, "infeasible");
});

test("all-zero, extreme, nonfinite, and malformed targets fail clearly", async () => {
  const cases = [
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, strictCalories: false },
    { ...unset(), kcal: 1000000 },
    { ...unset(), kcal: 5000 },
    { ...unset(), protein: 1000 },
    { ...unset(), protein: Infinity },
    { ...unset(), fat: -1 },
    { ...unset(), strictCalories: true },
    { ...unset(), kcal: 100, protein: 300 },
  ];
  for (const targets of cases) assert.equal((await generateRecipe(request({ targets }))).status, "needs_input");
});

test("numeric null targets remain unset and are preserved exactly", async () => {
  const input = request({ targets: unset() });
  const result = await recipe(input);
  assert.deepEqual(result.input.targets, unset());
  assert.equal(result.targetStatus, "matched");
});

test("goals never silently prescribe different calorie targets or deficits", async () => {
  for (const goal of ["fat_loss", "muscle", "maintenance"] as const) {
    const input = request({ preferences: { ...DEFAULT_INPUT.preferences, goal } });
    const result = await recipe(input);
    assert.deepEqual(result.input.targets, DEFAULT_INPUT.targets);
    assert.ok(Math.abs(result.nutritionPerServing.kcal - 500) <= 25);
    assert.ok(result.tips.some((tip) => tip.includes("non prescrive deficit")));
  }
});

test("fiber is a soft minimum, never a hidden hard constraint", async () => {
  const result = await recipe(request({ targets: { ...DEFAULT_INPUT.targets, fiber: 100 } }));
  assert.ok(result.nutritionPerServing.fiber < 100);
  assert.ok(result.deviations.some((line) => /Fibre.*morbido/.test(line)));
});

test("allergens exclude optional foods and conflict explicitly with locked foods", async () => {
  const input = request({ preferences: { ...DEFAULT_INPUT.preferences, allergens: ["milk"] } });
  const result = await recipe(input);
  assert.ok(result.ingredients.every((item) => !getIngredient(item.ingredientId)!.allergens.includes("milk")));
  const conflict = await generateRecipe(request({
    pantry: [...DEFAULT_INPUT.pantry.filter((item) => item.ingredientId !== "greek-yogurt"),
      { ingredientId: "greek-yogurt", availableGrams: 170, mode: "fixed", dietGrams: 50 }],
    preferences: { ...DEFAULT_INPUT.preferences, allergens: ["milk"] },
  }));
  assert.equal(conflict.status, "infeasible");
  assert.match(conflict.details.join(" "), /fisso.*allergene/);
});

test("oats are conservatively gluten-containing even in sweet recipes", async () => {
  const input = request({
    pantry: pantry("oats", "banana", "eggs", "greek-yogurt"),
    targets: unset(),
    preferences: { ...DEFAULT_INPUT.preferences, taste: "sweet", allergens: ["gluten"] },
  });
  const result = await recipe(input);
  assert.ok(!result.ingredients.some((item) => item.ingredientId === "oats"));
});

test("excluded and vegetarian fixed conflicts never get silently unlocked", async () => {
  for (const preferences of [
    { ...DEFAULT_INPUT.preferences, vegetarian: true },
    { ...DEFAULT_INPUT.preferences, excludedIngredientIds: ["chicken"] },
  ]) {
    const response = await generateRecipe(request({
      pantry: [{ ingredientId: "chicken", availableGrams: 200, mode: "fixed", dietGrams: 100 }],
      preferences,
    }));
    assert.equal(response.status, "infeasible");
  }
  const result = await recipe(request({
    pantry: pantry("tofu", "rice", "zucchini", "chicken"),
    preferences: { ...DEFAULT_INPUT.preferences, vegetarian: true },
  }));
  assert.ok(result.ingredients.every((item) => getIngredient(item.ingredientId)!.vegetarian));
});

test("added fat maximum applies per serving and oil is explicitly allocated once", async () => {
  const input = request({
    preferences: { ...DEFAULT_INPUT.preferences, maxAddedFatGrams: 3 },
  });
  const result = await recipe(input);
  assert.ok(result.fit.addedFatGrams <= 3);
  close(result.fit.addedFatGrams, (result.ingredients.find((item) => item.ingredientId === "olive-oil")?.grams ?? 0));
  assert.ok(result.nutritionPerServing.fat >= result.fit.addedFatGrams);
  if (result.templateId === "one-pan-rice") {
    assert.equal(result.steps.slice(1).filter((step) => step.instruction.includes("g di Olio extravergine di oliva")).length, 1);
  }
  const noOil = await recipe(request({ preferences: { ...DEFAULT_INPUT.preferences, maxAddedFatGrams: 0 } }));
  assert.ok(!noOil.ingredients.some((item) => item.ingredientId === "olive-oil"));
});

test("preferred is a preference, not a fixed inclusion requirement", async () => {
  const input = request({
    pantry: [...DEFAULT_INPUT.pantry, { ingredientId: "banana", availableGrams: 100, mode: "preferred" }],
  });
  const result = await recipe(input);
  assert.ok(!result.ingredients.some((item) => item.ingredientId === "banana"));
});

test("missing ingredients, duplicates, unknown tools and unknown allergens are surfaced", async () => {
  for (const input of [
    request({ pantry: [{ ingredientId: "invented", availableGrams: 100, mode: "available" }] }),
    request({ pantry: [...DEFAULT_INPUT.pantry, DEFAULT_INPUT.pantry[0]] }),
    request({ preferences: { ...DEFAULT_INPUT.preferences, allergens: ["unknown-allergen"] } }),
    request({ preferences: { ...DEFAULT_INPUT.preferences, equipment: ["magic" as "pan"] } }),
    request({ preferences: { ...DEFAULT_INPUT.preferences, excludedIngredientIds: ["not-in-catalog"] } }),
  ]) assert.equal((await generateRecipe(input)).status, "needs_input");
  assert.equal((await generateRecipe(request({ pantry: [] }))).status, "needs_input");
  assert.equal((await generateRecipe(request({ pantry: pantry("rice") }))).status, "infeasible");
});

test("no tools rejects cooked pantry, permits genuinely no-cook food", async () => {
  assert.equal((await generateRecipe(request({
    preferences: { ...DEFAULT_INPUT.preferences, equipment: [] },
  }))).status, "infeasible");
  const input = request({
    pantry: pantry("greek-yogurt", "banana"),
    targets: unset(),
    preferences: { ...DEFAULT_INPUT.preferences, taste: "sweet", equipment: [], maxTime: 10 },
  });
  const result = await recipe(input);
  checkIntegrity(result, input);
  assert.equal(result.family, "dessert");
  assert.ok(!result.steps.some((step) => /microonde|padella|frulla/.test(step.instruction)));
});

test("pan without stove does not permit cooking", async () => {
  const response = await generateRecipe(request({
    preferences: { ...DEFAULT_INPUT.preferences, equipment: ["pan"] },
  }));
  assert.equal(response.status, "infeasible");
});

test("raw poultry and egg ingredients require a declared thermometer, including fixed conflicts", async () => {
  const equipment = DEFAULT_INPUT.preferences.equipment.filter((tool) => tool !== "thermometer");
  for (const ingredientId of ["chicken", "turkey", "eggs", "egg-whites"]) {
    const response = await generateRecipe(request({
      pantry: [{ ingredientId, availableGrams: 200, mode: "fixed", dietGrams: 100 }],
      preferences: { ...DEFAULT_INPUT.preferences, equipment },
    }));
    assert.equal(response.status, "infeasible");
    assert.match(response.details.join(" "), /fisso.*termometro alimentare/);
  }
  const missing = await generateRecipe(request({
    preferences: { ...DEFAULT_INPUT.preferences, equipment },
  }));
  assert.equal(missing.status, "infeasible");
  assert.match(missing.details.join(" "), /Manca il termometro/);
});

test("without a thermometer, cooked alternatives remain eligible in the same templates", async () => {
  const equipment = DEFAULT_INPUT.preferences.equipment.filter((tool) => tool !== "thermometer");
  const input = request({
    pantry: pantry("rice", "chicken", "turkey", "eggs", "egg-whites", "tofu", "tuna", "zucchini", "greek-yogurt"),
    targets: unset(),
    preferences: { ...DEFAULT_INPUT.preferences, equipment },
  });
  const first = await recipe(input);
  checkIntegrity(first, input);
  const secondInput = { ...input, history: [first.fingerprint] };
  const second = await recipe(secondInput);
  checkIntegrity(second, secondInput);
  for (const result of [first, second]) {
    assert.ok(["one-pan-rice", "poached-rice-salad"].includes(result.templateId));
    assert.ok(result.ingredients.some((item) => ["tofu", "tuna"].includes(item.ingredientId)));
    assert.ok(!result.ingredients.some((item) => ["chicken", "turkey", "eggs", "egg-whites"].includes(item.ingredientId)));
    assert.ok(!/7[14] °C|termometro alimentare/.test(result.steps.map((step) => step.instruction).join(" ")));
    assert.ok(result.substitutions.every((item) => !["chicken", "turkey", "eggs", "egg-whites"].includes(item.replacementId)));
  }
});

test("without a thermometer, sweet choices avoid egg-based pancakes but allow yogurt cups", async () => {
  const input = request({
    pantry: pantry("oats", "eggs", "banana", "greek-yogurt"),
    targets: unset(),
    preferences: {
      ...DEFAULT_INPUT.preferences, taste: "sweet",
      equipment: DEFAULT_INPUT.preferences.equipment.filter((tool) => tool !== "thermometer"),
    },
  });
  const result = await recipe(input);
  checkIntegrity(result, input);
  assert.equal(result.templateId, "yogurt-fruit-parfait");
  assert.ok(!result.ingredients.some((item) => item.ingredientId === "eggs"));
  const noAlternative = await generateRecipe({
    ...input, pantry: pantry("oats", "eggs", "banana"),
  });
  assert.equal(noAlternative.status, "infeasible");
});

test("meal prep without a thermometer never prescribes thermometer-dependent reheating", async () => {
  const input = request({
    pantry: pantry("rice", "tofu", "zucchini"),
    targets: unset(),
    preferences: {
      ...DEFAULT_INPUT.preferences, mealPrep: true,
      equipment: DEFAULT_INPUT.preferences.equipment.filter((tool) => tool !== "thermometer"),
    },
  });
  const result = await recipe(input);
  checkIntegrity(result, input);
  assert.ok(result.tips.some((tip) => tip.includes("consuma questa preparazione fredda")));
  assert.ok(!/7[14] °C|termometro alimentare/.test([...result.tips, ...result.steps.map((step) => step.instruction)].join(" ")));
});

test("highProtein means at least 25 percent of energy actually comes from protein", async () => {
  const result = await recipe(request({
    preferences: { ...DEFAULT_INPUT.preferences, highProtein: true },
  }));
  assert.ok(result.fit.proteinEnergyPercentage >= 25);
  const noProtein = await generateRecipe(request({
    pantry: pantry("oats", "banana", "milk"),
    targets: unset(),
    preferences: { ...DEFAULT_INPUT.preferences, taste: "sweet", highProtein: true, equipment: ["microwave"] },
  }));
  assert.equal(noProtein.status, "infeasible");
});

test("meal prep requires refrigeration and total time at most 35, without overnight waits", async () => {
  const input = request({ preferences: { ...DEFAULT_INPUT.preferences, mealPrep: true } });
  const result = await recipe(input);
  assert.ok(result.minutes <= 35);
  assert.ok(result.tips.some((line) => line.includes("entro 2 ore")));
  assert.equal((await generateRecipe(request({
    preferences: { ...DEFAULT_INPUT.preferences, mealPrep: true, equipment: ["pan", "stove"] },
  }))).status, "infeasible");
});

test("unknown added sugar stays unknown, not zero", async () => {
  const input = request({
    pantry: [
      ...pantry("greek-yogurt", "banana"),
      { ingredientId: "whey", availableGrams: 30, mode: "fixed", dietGrams: 15 },
    ],
    targets: unset(),
    preferences: { ...DEFAULT_INPUT.preferences, taste: "sweet" },
  });
  const result = await recipe(input);
  assert.equal(result.fit.addedSugarGrams, null);
  assert.ok(result.warnings.some((line) => /sconosciuto, non zero/.test(line)));
});

test("honey sugar is counted as added sugar, while fruit sugar is not", async () => {
  const result = await recipe(request({
    pantry: [...pantry("greek-yogurt", "banana"), { ingredientId: "honey", availableGrams: 20, mode: "fixed", dietGrams: 10 }],
    targets: unset(),
    preferences: { ...DEFAULT_INPUT.preferences, taste: "sweet" },
  }));
  close(result.fit.addedSugarGrams!, 8.24);
});

test("protein variant enforces a real ten percent improvement without editing targets again", async () => {
  const baseline = await recipe(request());
  const input = request({
    targets: { ...DEFAULT_INPUT.targets, protein: 48 },
    variant: {
      kind: "protein", baselineNutrition: baseline.nutritionPerServing,
      baselineMinutes: baseline.minutes, baselineRecipeId: baseline.id,
    },
  });
  const result = await recipe(input);
  assert.ok(result.nutritionPerServing.protein >= baseline.nutritionPerServing.protein * 1.1 - 1e-6);
  assert.equal(result.input.targets.protein, 48);
});

test("lighter variant enforces a real ten percent calorie reduction", async () => {
  const baseline = await recipe(request());
  const input = request({
    targets: { ...DEFAULT_INPUT.targets, kcal: 440 },
    variant: {
      kind: "lighter", baselineNutrition: baseline.nutritionPerServing,
      baselineMinutes: baseline.minutes, baselineRecipeId: baseline.id,
    },
  });
  const result = await recipe(input);
  assert.ok(result.nutritionPerServing.kcal <= baseline.nutritionPerServing.kcal * 0.9 + 1e-6);
  assert.equal(result.input.targets.kcal, 440);
});

test("faster variant is strictly shorter, or explicitly infeasible", async () => {
  const baseline = await recipe(request());
  const response = await generateRecipe(request({
    variant: {
      kind: "faster", baselineNutrition: baseline.nutritionPerServing,
      baselineMinutes: 30, baselineRecipeId: baseline.id,
    },
  }));
  assert.equal(response.status, "ok");
  if (response.status === "ok") assert.ok(response.recipe.minutes < 30);
  const impossible = await generateRecipe(request({
    variant: {
      kind: "faster", baselineNutrition: baseline.nutritionPerServing,
      baselineMinutes: 5, baselineRecipeId: baseline.id,
    },
  }));
  assert.equal(impossible.status, "infeasible");
  assert.match(impossible.details.join(" "), /strettamente più breve/);
});

test("impossible protein and lighter variants explain the failed improvement", async () => {
  for (const kind of ["protein", "lighter"] as const) {
    const nutrition: Nutrients = { kcal: 50, protein: 500, carbs: 0, fat: 0, fiber: 0 };
    const response = await generateRecipe(request({
      variant: { kind, baselineNutrition: nutrition, baselineMinutes: 30, baselineRecipeId: "base" },
    }));
    assert.equal(response.status, "infeasible");
    assert.match(response.details.join(" "), /10%/);
  }
});

test("another includes baseline in repeat avoidance", async () => {
  const baseline = await recipe(request());
  const result = await recipe(request({
    history: [baseline.fingerprint],
    variant: { kind: "another", baselineNutrition: baseline.nutritionPerServing, baselineMinutes: baseline.minutes, baselineRecipeId: baseline.id },
  }));
  assert.notEqual(result.fingerprint.signature, baseline.fingerprint.signature);
});

test("sweet variant respects the already changed taste and input snapshot", async () => {
  const result = await recipe(request({
    pantry: pantry("banana", "greek-yogurt"),
    targets: unset(),
    preferences: { ...DEFAULT_INPUT.preferences, taste: "sweet" },
    variant: { kind: "sweet", baselineNutrition: { kcal: 400, protein: 30, carbs: 40, fat: 13, fiber: 4 }, baselineMinutes: 30, baselineRecipeId: "savory-base" },
  }));
  assert.equal(result.input.preferences.taste, "sweet");
  assert.equal(TEMPLATES.find((entry) => entry.id === result.templateId)!.taste, "sweet");
});

test("fingerprints ignore cosmetic quantities while plan hash binds actual quantities", async () => {
  const baseInput = request({
    pantry: [
      { ingredientId: "chicken", availableGrams: 200, mode: "fixed", dietGrams: 120 },
      { ingredientId: "rice", availableGrams: 100, mode: "fixed", dietGrams: 60 },
      { ingredientId: "zucchini", availableGrams: 250, mode: "fixed", dietGrams: 150 },
    ],
    targets: unset(),
  });
  const first = await recipe(baseInput);
  const changed = structuredClone(baseInput);
  changed.pantry[0].dietGrams = 130;
  const second = await recipe(changed);
  assert.notEqual(first.planHash, second.planHash);
  assert.equal(first.fingerprint.signature, second.fingerprint.signature);
  assert.equal(first.fingerprint.structuralSignature, second.fingerprint.structuralSignature);
  const cosmetic = structuredClone(baseInput);
  cosmetic.pantry.push({ ingredientId: "salt", availableGrams: 1, mode: "fixed", dietGrams: 0.5 });
  const third = await recipe(cosmetic);
  assert.equal(first.fingerprint.signature, third.fingerprint.signature);
  assert.notEqual(first.planHash, third.planHash);
});

test("editorial titles describe the real ingredient choices rather than invented flavours or structures", async () => {
  const input = request({
    pantry: [
      ...pantry("quinoa", "tofu", "broccoli"),
      { ingredientId: "paprika", availableGrams: 2, mode: "fixed", dietGrams: 1 },
    ],
    targets: unset(),
  });
  const result = await recipe(input);
  assert.equal(result.title, "Quinoa alla paprika con tofu e broccoli");
  assert.ok(!/\briso\b|\bpollo\b/i.test(result.title));
  const withoutPaprika = await recipe({
    ...input, pantry: input.pantry.filter((item) => item.ingredientId !== "paprika"),
  });
  assert.equal(withoutPaprika.title, "Quinoa in padella con tofu e broccoli");
  const dessert = await recipe(request({
    pantry: pantry("skyr", "berries"), targets: unset(),
    preferences: { ...DEFAULT_INPUT.preferences, taste: "sweet" },
  }));
  assert.equal(dessert.title, "Coppa a strati di skyr e frutti di bosco");
  assert.ok(!/cheesecake|mousse|croccante|biscott/i.test(dessert.title));
});

test("salad titles claim crunch only when a genuinely crunchy vegetable is included", async () => {
  const base = request({
    pantry: pantry("lentils", "tomato"), targets: unset(),
    preferences: { ...DEFAULT_INPUT.preferences, equipment: [] },
  });
  const soft = await recipe(base);
  assert.equal(soft.title, "Insalata fresca di lenticchie e pomodori");
  const crisp = await recipe({ ...base, pantry: pantry("lentils", "cucumber") });
  assert.equal(crisp.title, "Insalata croccante di lenticchie e cetrioli");
});

function prescribedPasta(servings = 1): GenerateRequest {
  return {
    ...structuredClone(DEFAULT_MEAL_INPUT),
    pantry: createMealBase([
      { ingredientId: "tomato", grams: 150 },
      { ingredientId: "pasta", grams: 90 },
      { ingredientId: "cream-cheese", grams: 80 },
    ], servings),
    preferences: { ...DEFAULT_MEAL_INPUT.preferences, servings },
    history: [], nonce: "reported-pasta-meal",
  };
}

test("prescribed pasta, tomatoes and cream cheese generate without altering weights or adding food", async () => {
  for (const servings of [1, 2]) {
    const input = prescribedPasta(servings);
    const result = await recipe(input);
    assert.equal(result.templateId, "creamy-tomato-pasta");
    checkIntegrity(result, input);
    assert.equal(result.ingredients.length, 3);
    assert.equal(result.ingredients.find((item) => item.ingredientId === "pasta")!.grams, 90 * servings);
    assert.equal(result.ingredients.find((item) => item.ingredientId === "cream-cheese")!.grams, 80 * servings);
    assert.equal(result.ingredients.find((item) => item.ingredientId === "tomato")!.grams, 150 * servings);
    close(result.nutritionPerServing.kcal, 536.7);
    close(result.nutritionPerServing.protein, 17);
    close(result.nutritionPerServing.fat, 19.25);
    assert.equal(result.fit.addedFatGrams, 0);
    assert.equal(result.fit.addedSugarGrams, null);
    assert.ok(result.warnings.some((line) => /non i valori ufficiali Philadelphia/.test(line)));
    const breakdown = recipeMealBreakdown(result);
    assert.ok(breakdown);
    assert.equal(breakdown.extras.kcal, 0);
    close(breakdown.base.kcal, result.nutritionPerServing.kcal);
    assert.ok(result.steps.some((step) => /Spegni.*formaggio/.test(step.instruction)));
    assert.ok(!/alto contenuto proteico|high.protein/i.test(result.title));
  }
});

test("cream cheese pasta keeps allergy, protein, equipment and calorie constraints", async () => {
  for (const allergen of ["milk", "gluten"] as const) {
    const input = prescribedPasta();
    input.preferences.allergens = [allergen];
    assert.equal((await generateRecipe(input)).status, "infeasible");
  }
  const protein = prescribedPasta();
  protein.preferences.highProtein = true;
  assert.equal((await generateRecipe(protein)).status, "infeasible");
  const strict = prescribedPasta();
  strict.targets.kcal = 400;
  strict.targets.strictCalories = true;
  assert.equal((await generateRecipe(strict)).status, "infeasible");
  const closest = prescribedPasta();
  closest.targets.kcal = 400;
  const result = await recipe(closest);
  assert.equal(result.targetStatus, "closest");
  close(result.nutritionPerServing.kcal, 536.7);
  const tools = prescribedPasta();
  tools.preferences.equipment = [];
  assert.equal((await generateRecipe(tools)).status, "infeasible");
});

const archetypes: Array<{ id: string; foods: string[]; sweet?: boolean; maxTime?: number; fixed?: string }> = [
  { id: "one-pan-rice", foods: ["rice", "chicken", "zucchini"] },
  { id: "poached-rice-salad", foods: ["rice", "chicken", "zucchini", "greek-yogurt"], maxTime: 29 },
  { id: "oat-egg-crepe", foods: ["oats", "eggs", "tuna", "cucumber"] },
  { id: "banana-oat-pancakes", foods: ["oats", "eggs", "banana"], sweet: true },
  { id: "yogurt-fruit-parfait", foods: ["greek-yogurt", "strawberries"], sweet: true },
  { id: "cocoa-banana-cream", foods: ["greek-yogurt", "banana", "cocoa"], sweet: true, fixed: "cocoa" },
  { id: "vegetable-frittata", foods: ["eggs", "spinach"] },
  { id: "legume-crunch-salad", foods: ["chickpeas", "cucumber"] },
  { id: "tuna-vegetable-pasta", foods: ["pasta", "tuna", "tomato"] },
  { id: "legume-oat-patties", foods: ["lentils", "oats", "eggs"] },
  { id: "potato-protein-skillet", foods: ["potato", "chicken", "zucchini"] },
  { id: "ready-wrap", foods: ["whole-wheat-wrap", "tuna", "cucumber"] },
  { id: "microwave-porridge", foods: ["oats", "milk", "banana"], sweet: true },
  { id: "caprese-pasta", foods: ["pasta", "mozzarella-light", "tomato"] },
  { id: "creamy-tomato-pasta", foods: ["pasta", "cream-cheese", "tomato"] },
];

for (const fixture of archetypes) {
  test(`vetted archetype: ${fixture.id}, every ingredient actually used and no hidden extras`, async () => {
    const stock = pantry(...fixture.foods);
    if (fixture.fixed) {
      const locked = stock.find((item) => item.ingredientId === fixture.fixed)!;
      locked.mode = "fixed";
      locked.dietGrams = 6;
    }

    const input = request({
      pantry: stock, targets: unset(),
      preferences: {
        ...DEFAULT_INPUT.preferences, taste: fixture.sweet ? "sweet" : "savory",
        difficulty: "medium", maxTime: fixture.maxTime ?? 40,
        equipment: ["pan", "stove", "blender", "microwave", "thermometer"],
      },
    });
    const result = await recipe(input);
    assert.equal(result.templateId, fixture.id);
    checkIntegrity(result, input);
    const template = TEMPLATES.find((item) => item.id === fixture.id)!;
    assert.equal(result.title, buildTitle(template, result.ingredients));
    assert.ok(result.title.length <= 160);
    assert.notEqual(result.title, template.title, "Each archetype gets an ingredient-specific editorial title");
    const instructions = result.steps.slice(1).map((step) => step.instruction).join(" ");
    assert.ok(!/aggiungi (?:il |lo |la |un |una |)(?:sale|olio|burro|farina|lievito|latte)\b/i.test(instructions), instructions);
    for (const food of INGREDIENTS.filter((item) => item.id !== "water" && !fixture.foods.includes(item.id))) {
      const pattern = new RegExp(`\\b${food.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      assert.ok(!pattern.test(instructions), `Hidden ${food.name}: ${instructions}`);
    }
  });
}
