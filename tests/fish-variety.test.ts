import assert from "node:assert/strict";
import test from "node:test";
import { getIngredient } from "../src/lib/catalog";
import { DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { calculateNutrition, generateRecipe } from "../src/lib/engine";
import { optimizeTemplate } from "../src/lib/engine-optimizer";
import { buildSteps, formatGrams } from "../src/lib/engine-steps";
import { buildTitle } from "../src/lib/engine-titles";
import { TEMPLATES } from "../src/lib/templates";
import type { GenerateRequest, Recipe, RecipeItem } from "../src/lib/types";

// Synthetic fish compositions, with no weekday or private prescription mapping.
const cases = [
  { protein: "white-fish", grams: 185, fallback: "white-fish-bread-salad", templates: ["cod-lettuce-boats", "cod-toasted-tartines"] },
  { protein: "seafood-salad", grams: 230, fallback: "seafood-bread-salad", templates: ["seafood-panzanella", "seafood-lettuce-cups"] },
];
const extras: Record<string, number> = { "greek-yogurt": 40, lemon: 15, paprika: 1, "olive-oil": 5 };

function request(fixture: typeof cases[number], servings = 1, extraIds: string[] = []): GenerateRequest {
  return {
    ...structuredClone(DEFAULT_MEAL_INPUT),
    pantry: [
      ...Object.entries({ [fixture.protein]: fixture.grams, bread: 64, lettuce: 125 }).map(([ingredientId, dietGrams]) => ({
        ingredientId, dietGrams, availableGrams: dietGrams * servings, mode: "fixed" as const,
      })),
      ...extraIds.map((ingredientId) => ({
        ingredientId, dietGrams: extras[ingredientId], availableGrams: extras[ingredientId] * servings, mode: "preferred" as const,
      })),
    ],
    preferences: {
      ...structuredClone(DEFAULT_MEAL_INPUT.preferences),
      taste: "savory", servings, maxTime: 35,
      equipment: fixture.protein === "white-fish" ? ["pan", "stove", "thermometer"] : ["pan", "stove"],
    },
    history: [], nonce: "synthetic-fish-variety",
  };
}

async function recipe(input: GenerateRequest): Promise<Recipe> {
  const response = await generateRecipe(input);
  assert.equal(response.status, "ok", JSON.stringify(response));
  return response.recipe;
}

async function collectFormats(input: GenerateRequest): Promise<Recipe[]> {
  const history = [...input.history];
  const result: Recipe[] = [];
  for (let index = 0; index < 3; index++) {
    const previous = result.at(-1);
    const generated = await recipe({
      ...input, history,
      ...(previous ? { variant: {
        kind: "another" as const, baselineNutrition: previous.nutritionPerServing,
        baselineMinutes: previous.minutes, baselineRecipeId: previous.id,
      } } : {}),
    });
    result.push(generated);
    history.push({ ...generated.fingerprint, createdAt: new Date(Date.UTC(2030, 0, index + 1)).toISOString() });
  }
  return result;
}

function verify(recipe: Recipe, input: GenerateRequest) {
  assert.deepEqual(recipe.nutritionTotal, calculateNutrition(recipe.ingredients));
  assert.deepEqual(recipe.nutritionPerServing, calculateNutrition(recipe.ingredients.map((item) => ({
    ingredientId: item.ingredientId, grams: item.grams / input.preferences.servings,
  }))));
  assert.deepEqual(recipe.input, { pantry: input.pantry, preferences: input.preferences, targets: input.targets });
  assert.equal(recipe.servings, input.preferences.servings);
  const template = TEMPLATES.find((entry) => entry.id === recipe.templateId)!;
  assert.equal(recipe.minutes, template.minutes + template.extraServingMinutes * (recipe.servings - 1));
  assert.equal(recipe.minutes, recipe.steps.reduce((sum, step) => sum + step.minutes, 0));
  assert.ok(recipe.minutes <= input.preferences.maxTime);
  assert.ok(template.equipment.every((tool) => input.preferences.equipment.includes(tool)));
  const instructions = recipe.steps.slice(1).map((step) => step.instruction).join(" ");
  for (const item of recipe.ingredients) {
    const stock = input.pantry.find((entry) => entry.ingredientId === item.ingredientId)!;
    assert.ok(stock && item.grams > 0 && item.grams <= stock.availableGrams);
    assert.equal(item.state, getIngredient(item.ingredientId)!.state);
    assert.ok(instructions.includes(`${formatGrams(item.grams)} di ${item.name}`), `Not consumed: ${item.ingredientId}`);
  }
  for (const fixed of input.pantry.filter((item) => item.mode === "fixed")) {
    assert.equal(recipe.ingredients.find((item) => item.ingredientId === fixed.ingredientId)!.grams, fixed.dietGrams! * recipe.servings);
  }
  assert.ok(!recipe.ingredients.some((item) => ["breadcrumbs", "wheat-flour", "eggs"].includes(item.ingredientId)));
  assert.ok(!/\bFIT\b|alto contenuto proteico|fritto/i.test(recipe.title));
}

for (const fixture of cases) {
  for (const servings of [1, 2]) {
    for (const withExtras of [false, true]) {
      test(`${fixture.protein}: three genuinely different formats, ${servings} servings, extras=${withExtras}`, async () => {
        const input = request(fixture, servings, withExtras ? Object.keys(extras) : []);
        const snapshot = structuredClone(input);
        const recipes = await collectFormats(input);
        assert.deepEqual(recipes.map((entry) => entry.templateId).sort(), [fixture.fallback, ...fixture.templates].sort());
        assert.equal(new Set(recipes.map((entry) => entry.technique)).size, 3);
        assert.equal(new Set(recipes.map((entry) => entry.fingerprint.structuralSignature)).size, 3);
        for (const result of recipes) {
          verify(result, input);
          if (!withExtras) assert.equal(result.ingredients.length, 3);
          if (withExtras && fixture.templates.includes(result.templateId)) {
            assert.equal(result.ingredients.length, 7);
            for (const [id, grams] of Object.entries(extras)) {
              assert.equal(result.ingredients.find((item) => item.ingredientId === id)!.grams, grams * servings);
            }
            assert.equal(result.fit.addedFatGrams, 5);
            const count = result.steps.slice(1).filter((step) => step.instruction.includes(`${formatGrams(5 * servings)} di Olio extravergine di oliva`)).length;
            assert.equal(count, 1, "Oil must only be allocated once.");
          }
          const instructions = result.steps.map((step) => step.instruction).join(" ");
          if (fixture.protein === "white-fish") assert.match(instructions, /63 °C.*termometro alimentare/);
          else assert.ok(!/termometro|63 °C|74 °C/.test(instructions));
        }
        assert.deepEqual(input, snapshot);
      });
    }
  }
}

test("cod boats and tartines transform bread and lettuce differently without fake breading", async () => {
  const input = request(cases[0], 2, Object.keys(extras));
  const recipes = await collectFormats(input);
  const boats = recipes.find((entry) => entry.templateId === "cod-lettuce-boats")!;
  const tartines = recipes.find((entry) => entry.templateId === "cod-toasted-tartines")!;
  assert.match(boats.steps[1].instruction, /128 g di Pane di frumento.*crumble grossolano.*prima di manipolare il pesce crudo/);
  assert.match(boats.steps[3].instruction, /La lattuga resta cruda.*mai quelli del pesce crudo/);
  assert.match(boats.steps.at(-1)!.instruction, /tutto il fondo cotto.*tutto il crumble.*non una panatura/);
  assert.match(tartines.steps[1].instruction, /128 g di Pane di frumento.*1 cm.*fette e briciole/);
  assert.match(tartines.steps[3].instruction, /soltanto dopo aver verificato.*63 °C.*foglie appassiscono/);
  assert.match(tartines.steps.at(-1)!.instruction, /tutto il pesce.*80 g di Yogurt.*incorpora l'intero condimento.*tutti i succhi/);
  assert.equal(boats.minutes, 34);
  assert.equal(tartines.minutes, 35);
});

test("ready seafood gets softened bread panzanella or cold lettuce cups, never raw-fish instructions", async () => {
  const input = request(cases[1], 2);
  const recipes = await collectFormats(input);
  const panzanella = recipes.find((entry) => entry.templateId === "seafood-panzanella")!;
  const cups = recipes.find((entry) => entry.templateId === "seafood-lettuce-cups")!;
  assert.match(panzanella.steps[1].instruction, /128 g di Pane di frumento.*52 ml di acqua potabile fredda.*non strizzarlo e non scolare/);
  assert.match(panzanella.steps[2].instruction, /già cotto.*non lessare nuovamente/);
  assert.match(panzanella.steps[3].instruction, /tutta la lattuga cruda.*tutto il pane reidratato/);
  assert.match(cups.steps[1].instruction, /128 g di Pane di frumento.*64 g a cubetti.*64 g tritati/);
  assert.match(cups.steps[2].instruction, /tutte le foglie piccole o rotte.*non scaldare il prodotto pronto.*tutti i cubetti/);
  assert.match(cups.steps[3].instruction, /tutto il ripieno freddo.*lattuga cruda.*tutto il crumble/);
  assert.equal(panzanella.minutes, 14);
  assert.equal(cups.minutes, 17);
});

test("every subset of approved extras works in each new template without dependency or hidden food", async () => {
  const ids = Object.keys(extras);
  for (const fixture of cases) {
    for (const templateId of fixture.templates) {
      const template = TEMPLATES.find((entry) => entry.id === templateId)!;
      for (let mask = 0; mask < 16; mask++) {
        const selected = ids.filter((_, index) => mask & (1 << index));
        const input = request(fixture, 1, selected);
        const planned = await optimizeTemplate(template, input.pantry, input);
        assert.ok(planned, `${templateId}, mask=${mask}`);
        const items: RecipeItem[] = planned.map((item) => {
          const food = getIngredient(item.ingredientId)!;
          return { ...item, name: food.name, state: food.state, nutrients: calculateNutrition([item]) };
        });
        assert.deepEqual(items.map((item) => item.ingredientId).sort(), input.pantry.map((item) => item.ingredientId).sort());
        const instructions = buildSteps(template, items, 1).slice(1).map((step) => step.instruction).join(" ");
        for (const item of items) assert.ok(instructions.includes(`${formatGrams(item.grams)} di ${item.name}`));
        for (const id of ids.filter((id) => !selected.includes(id))) {
          assert.ok(!instructions.includes(getIngredient(id)!.name), `${templateId} invented ${id}`);
        }
        assert.ok(buildTitle(template, items).length <= 160);
      }
    }
  }
});

test("allergens, vegetarian restrictions, exclusions, stock and hard calorie limits are retained", async () => {
  for (const fixture of cases) {
    for (const allergen of new Set(["gluten", ...getIngredient(fixture.protein)!.allergens])) {
      const input = request(fixture);
      input.preferences.allergens = [allergen];
      assert.equal((await generateRecipe(input)).status, "infeasible");
    }
    for (const mutate of [
      (input: GenerateRequest) => { input.preferences.vegetarian = true; },
      (input: GenerateRequest) => { input.preferences.excludedIngredientIds = ["lettuce"]; },
      (input: GenerateRequest) => { input.pantry[0].availableGrams -= 1; },
      (input: GenerateRequest) => { input.targets.kcal = 50; input.targets.strictCalories = true; },
    ]) {
      const input = request(fixture, 2);
      mutate(input);
      assert.equal((await generateRecipe(input)).status, "infeasible");
    }
    const filtered = request(fixture, 1, Object.keys(extras));
    filtered.preferences.allergens = ["milk"];
    filtered.preferences.maxAddedFatGrams = 0;
    for (const result of await collectFormats(filtered)) {
      verify(result, filtered);
      assert.ok(!result.ingredients.some((item) => ["greek-yogurt", "olive-oil"].includes(item.ingredientId)));
      assert.equal(result.fit.addedFatGrams, 0);
    }
  }
});

test("raw cod requires declared cooking tools, while prepared seafood retains no-cook formats", async () => {
  for (const missing of ["pan", "stove", "thermometer"]) {
    const input = request(cases[0]);
    input.preferences.equipment = input.preferences.equipment.filter((tool) => tool !== missing);
    assert.equal((await generateRecipe(input)).status, "infeasible");
  }
  const cooked = request(cases[1], 2);
  cooked.preferences.equipment = [];
  const first = await recipe(cooked);
  const second = await recipe({ ...cooked, history: [first.fingerprint] });
  assert.deepEqual([first.templateId, second.templateId].sort(), ["seafood-bread-salad", "seafood-panzanella"].sort());
  for (const result of [first, second]) verify(result, cooked);
});

test("short limits preserve existing quick formats and do not silently substitute either fish option", async () => {
  for (const fixture of cases) {
    const input = request(fixture);
    input.preferences.maxTime = fixture.protein === "white-fish" ? 24 : 9;
    const quick = await recipe(input);
    assert.equal(quick.templateId, fixture.fallback);
    input.preferences.maxTime -= 1;
    assert.equal((await generateRecipe(input)).status, "infeasible");
  }
  const combined = request(cases[0]);
  combined.pantry.push({ ingredientId: "seafood-salad", dietGrams: 230, availableGrams: 230, mode: "fixed" });
  assert.equal((await generateRecipe(combined)).status, "infeasible");
});
