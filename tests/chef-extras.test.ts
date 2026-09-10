import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { getIngredient } from "../src/lib/catalog";
import { generateRecipe } from "../src/lib/engine";
import type { RecipeFingerprint } from "../src/lib/types";
import { confirmChefExtras, createMealBase, getChefExtraProposal, getMealExtraSuggestions, mealBaseNutrition } from "../src/lib/meal";

function poultryMeal() {
  const input = structuredClone(DEFAULT_MEAL_INPUT);
  input.pantry = createMealBase([
    { ingredientId: "chicken", grams: 165 },
    { ingredientId: "fennel", grams: 175 },
    { ingredientId: "bread", grams: 62 },
  ], 1);
  return input;
}

test("chef proposal is contextual and never authorizes extras by itself", () => {
  const input = poultryMeal();
  const original = structuredClone(input);
  const proposal = getChefExtraProposal(input);
  assert.ok(proposal);
  assert.match(proposal.title, /Crosta|slaw/);
  assert.ok(proposal.extras.length >= 2);
  assert.ok(proposal.extras.some((extra) => extra.ingredientId === "lemon"));
  assert.ok(!proposal.extras.some((extra) => ["breadcrumbs", "wheat-flour"].includes(extra.ingredientId)));
  assert.equal(proposal.maximumKcal, proposal.extras.reduce((total, extra) => total + getIngredient(extra.ingredientId)!.nutrients.kcal * extra.grams / 100, 0));
  assert.deepEqual(input, original);
  assert.equal(input.pantry.filter((item) => item.mode === "preferred").length, 0);
});

test("one explicit confirmation adds the proposed bundle without changing original grams or macros", () => {
  const input = poultryMeal();
  input.preferences.servings = 2;
  input.pantry = input.pantry.map((item) => ({ ...item, availableGrams: item.availableGrams * 2 }));
  const original = structuredClone(input);
  const proposal = getChefExtraProposal(input);
  assert.ok(proposal);
  const confirmed = confirmChefExtras(input, proposal.extras);
  assert.deepEqual(confirmed.pantry.filter((item) => item.mode === "fixed"), original.pantry);
  assert.deepEqual(mealBaseNutrition(confirmed.pantry), mealBaseNutrition(original.pantry));
  assert.deepEqual(input, original);
  for (const extra of proposal.extras) {
    const added = confirmed.pantry.find((item) => item.ingredientId === extra.ingredientId)!;
    assert.equal(added.mode, "preferred");
    assert.equal(added.dietGrams, extra.grams);
    assert.equal(added.availableGrams, extra.grams * 2);
  }
  assert.deepEqual(confirmChefExtras(confirmed, proposal.extras), confirmed);
});

test("proposals respect exclusions and refuse stale unsafe confirmations", () => {
  const input = poultryMeal();
  const proposal = getChefExtraProposal(input)!;
  const excluded = proposal.extras[0];
  input.preferences.excludedIngredientIds = [excluded.ingredientId];
  assert.ok(!getChefExtraProposal(input)?.extras.some((extra) => extra.ingredientId === excluded.ingredientId));
  assert.throws(() => confirmChefExtras(input, proposal.extras), /escluso/);
  input.preferences.excludedIngredientIds = ["chicken"];
  assert.equal(getChefExtraProposal(input), null);
  input.preferences.excludedIngredientIds = [];
  input.preferences.allergens = ["milk"];
  assert.ok(!getChefExtraProposal(input)?.extras.some((extra) => extra.ingredientId === "greek-yogurt"));
  input.preferences.vegetarian = true;
  assert.equal(getChefExtraProposal(input), null);
});

test("proposals do not offer incompatible flours or duplicate a food already prescribed", () => {
  const input = structuredClone(DEFAULT_MEAL_INPUT);
  input.pantry = createMealBase([
    { ingredientId: "pasta", grams: 84 }, { ingredientId: "tomato", grams: 130 },
    { ingredientId: "cream-cheese", grams: 62 },
  ], 1);
  const suggestions = getMealExtraSuggestions(input.pantry, "savory");
  assert.ok(!suggestions.some((extra) => ["wheat-flour", "breadcrumbs", "cream-cheese"].includes(extra.ingredientId)));
  const unsupported = { ingredientId: "wheat-flour", grams: 10, maxGrams: 20, reason: "invalid proposal" };
  assert.throws(() => confirmChefExtras(input, [unsupported]), /compatibile/);
});

test("invalid doses and duplicate proposal entries are rejected without modifying the meal", () => {
  const input = poultryMeal();
  const snapshot = structuredClone(input);
  const extra = getChefExtraProposal(input)!.extras[0];
  assert.throws(() => confirmChefExtras(input, [{ ...extra, grams: extra.maxGrams + 1 }]), /compatibile/);
  assert.throws(() => confirmChefExtras(input, [extra, extra]), /compatibile/);
  assert.deepEqual(input, snapshot);
  input.preferences.maxTime = 1;
  assert.equal(getChefExtraProposal(input), null);
});

test("exhausting creative variations does not disguise the old plain plate as a new idea", async () => {
  const input = poultryMeal();
  const history: RecipeFingerprint[] = [];
  const templates: string[] = [];
  for (let index = 0; index < 3; index++) {
    const result = await generateRecipe({ ...input, history, nonce: `creative-repeat-${index}` });
    assert.equal(result.status, "ok");
    assert.ok(["poultry-fennel-crunch", "poultry-fennel-tartines"].includes(result.recipe.templateId));
    templates.push(result.recipe.templateId);
    history.push(result.recipe.fingerprint);
    if (index === 2) assert.ok(result.recipe.warnings.some((warning) => /Ripetizione esplicita/.test(warning)));
  }
  assert.notEqual(templates[0], templates[1]);
  input.preferences.maxTime = 25;
  const quick = await generateRecipe({ ...input, history: [], nonce: "explicit-short-time" });
  assert.equal(quick.status, "ok");
  assert.equal(quick.recipe.templateId, "poultry-fennel-plate");
});
