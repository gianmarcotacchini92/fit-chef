import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_VERSION, getIngredient } from "../src/lib/catalog";
import { DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { calculateNutrition, generateRecipe } from "../src/lib/engine";
import { formatGrams } from "../src/lib/engine-steps";
import { TEMPLATES } from "../src/lib/templates";
import type { GenerateRequest, Recipe } from "../src/lib/types";

type Foods = Record<string, number>;
type Fixture = {
  name: string;
  foods: Foods;
  template: string;
  sweet?: boolean;
  breakfast?: boolean;
  maxTime?: number;
  safety?: number;
};

// Synthetic recipe examples, not a person's calendar or prescribed quantities.
const fixtures: Fixture[] = [
  { name: "ready pancake sample", foods: { coffee: 41, "ready-pancakes": 103, jam: 17, "peanut-butter": 11 }, template: "ready-pancake-breakfast", sweet: true, breakfast: true },
  { name: "cereal breakfast sample", foods: { coffee: 41, "greek-yogurt": 165, "breakfast-cereal": 32, "dark-chocolate": 13, cocoa: 3.2 }, template: "cereal-yogurt-bowl", sweet: true, breakfast: true },
  { name: "explicit oat alternative", foods: { coffee: 41, "greek-yogurt": 165, oats: 32, "dark-chocolate": 13, cocoa: 3.2 }, template: "cereal-yogurt-bowl", sweet: true, breakfast: true },
  { name: "bread breakfast sample", foods: { coffee: 41, bread: 63, "cooked-ham": 38, "cheese-slice": 18.3 }, template: "ham-cheese-bread", breakfast: true },
  { name: "quantified whey sample", foods: { coffee: 41, whey: 22.5 }, template: "whey-drink", sweet: true, breakfast: true },
  { name: "fruit and whey sample", foods: { apple: 127, whey: 24 }, template: "whey-drink", sweet: true },
  { name: "ready protein snack sample", foods: { banana: 131, "protein-bar": 43 }, template: "fruit-protein-snack", sweet: true },
  { name: "creamy pasta sample", foods: { tomato: 123, pasta: 64, "cream-cheese": 46 }, template: "creamy-tomato-pasta" },
  { name: "tuna pasta sample", foods: { zucchini: 143, pasta: 72, tuna: 96 }, template: "tuna-vegetable-pasta" },
  { name: "egg wrap sample", foods: { lettuce: 119, "plain-wrap": 76, eggs: 94.3 }, template: "egg-lettuce-wrap", safety: 71 },
  { name: "dry brown rice sample", foods: { zucchini: 143, "brown-rice": 68, "smoked-salmon": 82 }, template: "brown-rice-salmon", maxTime: 65 },
  { name: "cod sample", foods: { lettuce: 119, bread: 58, "white-fish": 175 }, template: "white-fish-bread-salad", safety: 63 },
  { name: "cooked seafood sample", foods: { lettuce: 119, bread: 58, "seafood-salad": 225 }, template: "seafood-bread-salad" },
  { name: "chicken sample", foods: { fennel: 137, bread: 58, chicken: 145 }, template: "poultry-fennel-plate", safety: 74 },
  { name: "turkey sample", foods: { fennel: 137, bread: 58, turkey: 145 }, template: "poultry-fennel-plate", safety: 74 },
  { name: "regular mozzarella sample", foods: { tomato: 123, bread: 58, mozzarella: 135 }, template: "tomato-cheese-bread" },
  { name: "caciotta sample", foods: { tomato: 123, bread: 58, caciotta: 92 }, template: "tomato-cheese-bread" },
  { name: "lean ground beef sample", foods: { zucchini: 143, bread: 58, "lean-beef": 155 }, template: "beef-zucchini-patties", safety: 71 },
  { name: "cottage cheese sample", foods: { tomato: 123, bread: 58, "cottage-cheese": 155 }, template: "tomato-cheese-bread" },
  { name: "all quantified Parmesan sample", foods: { tomato: 123, pasta: 64, parmesan: 23 }, template: "tomato-parmesan-pasta" },
];

function request(fixture: Fixture, servings = 1): GenerateRequest {
  return {
    ...structuredClone(DEFAULT_MEAL_INPUT),
    pantry: Object.entries(fixture.foods).map(([ingredientId, dietGrams]) => ({
      ingredientId, dietGrams, availableGrams: dietGrams * servings, mode: "fixed",
    })),
    preferences: {
      ...structuredClone(DEFAULT_MEAL_INPUT.preferences), servings,
      maxTime: fixture.maxTime ?? 45,
      taste: fixture.sweet ? "sweet" : "savory",
      meal: fixture.breakfast ? "breakfast" : fixture.sweet ? "snack" : "lunch",
    },
    history: [], nonce: "weekly-exact-meal",
  };
}

async function recipe(input: GenerateRequest): Promise<Recipe> {
  const result = await generateRecipe(input);
  assert.equal(result.status, "ok", JSON.stringify(result));
  return result.recipe;
}

function verify(result: Recipe, input: GenerateRequest) {
  const servings = input.preferences.servings;
  const instructions = result.steps.slice(1).map((step) => step.instruction).join(" ");
  assert.equal(result.servings, servings);
  assert.deepEqual(result.nutritionTotal, calculateNutrition(result.ingredients));
  assert.deepEqual(result.nutritionPerServing, calculateNutrition(result.ingredients.map((item) => ({
    ingredientId: item.ingredientId, grams: item.grams / servings,
  }))));
  assert.equal(result.minutes, result.steps.reduce((sum, step) => sum + step.minutes, 0));
  const template = TEMPLATES.find((entry) => entry.id === result.templateId)!;
  assert.equal(result.minutes, template.minutes + template.extraServingMinutes * (servings - 1));
  assert.ok(result.minutes <= input.preferences.maxTime);
  assert.ok(template.equipment.every((tool) => input.preferences.equipment.includes(tool)));
  for (const item of result.ingredients) {
    const stock = input.pantry.find((entry) => entry.ingredientId === item.ingredientId)!;
    assert.ok(stock, `No implicit food: ${item.ingredientId}`);
    assert.ok(item.grams <= stock.availableGrams + 1e-6);
    assert.ok(instructions.includes(`${formatGrams(item.grams)} di ${item.name}`), `Not used: ${item.name}`);
    assert.equal(item.state, getIngredient(item.ingredientId)!.state);
  }
  for (const fixed of input.pantry.filter((item) => item.mode === "fixed")) {
    assert.equal(result.ingredients.find((item) => item.ingredientId === fixed.ingredientId)!.grams, fixed.dietGrams! * servings);
  }
  assert.deepEqual(result.input, { pantry: input.pantry, preferences: input.preferences, targets: input.targets });
  assert.ok(result.fit.nutritionSource.includes(CATALOG_VERSION));
  assert.ok(!/\bFIT\b|alto contenuto proteico|high.protein/i.test(result.title));
  if (/termometro alimentare/.test(instructions)) assert.ok(input.preferences.equipment.includes("thermometer"));
}

for (const fixture of fixtures) {
  test(`weekly composition: ${fixture.name}, fixed weights and no extras at one/two servings`, async () => {
    for (const servings of [1, 2]) {
      const input = request(fixture, servings);
      const original = structuredClone(input);
      const result = await recipe(input);
      if (fixture.template === "poultry-fennel-plate") {
        assert.ok(["poultry-fennel-crunch", "poultry-fennel-tartines"].includes(result.templateId));
      } else if (fixture.template === "white-fish-bread-salad") {
        assert.ok(["white-fish-bread-salad", "cod-lettuce-boats", "cod-toasted-tartines"].includes(result.templateId));
      } else if (fixture.template === "seafood-bread-salad") {
        assert.ok(["seafood-bread-salad", "seafood-panzanella", "seafood-lettuce-cups"].includes(result.templateId));
      } else {
        assert.equal(result.templateId, fixture.template);
      }
      verify(result, input);
      assert.deepEqual(input, original);
      assert.deepEqual(result.ingredients.map((item) => item.ingredientId).sort(), Object.keys(fixture.foods).sort());
      assert.equal(result.fit.addedFatGrams, 0);
      if (fixture.safety) {
        assert.ok(result.steps.some((step) => step.instruction.includes(`${fixture.safety} °C`)));
      }
      if (fixture.foods.coffee) {
        const last = result.steps.at(-1)!.instruction;
        assert.match(last, /Servi separatamente .*Caffè.*non incorporarlo/);
        assert.ok(result.ingredients.find((item) => item.ingredientId === "coffee")!.nutrients.kcal > 0);
      }
    }
  });
}

test("all contracted foods exist with honest generic states, allergens and non-light aliases", () => {
  const ids = [
    "lean-beef", "breadcrumbs", "wheat-flour", "bread", "brown-rice", "smoked-salmon",
    "white-fish", "seafood-salad", "fennel", "lettuce", "mozzarella", "caciotta", "parmesan",
    "cooked-ham", "cheese-slice", "jam", "breakfast-cereal", "dark-chocolate",
    "ready-pancakes", "protein-bar", "coffee", "plain-wrap",
  ];
  for (const id of ids) {
    const food = getIngredient(id)!;
    assert.ok(food, id);
    assert.match(food.source, /Stima editoriale generica/);
  }
  assert.ok(!getIngredient("mozzarella-light")!.aliases.includes("mozzarella"));
  assert.ok(getIngredient("mozzarella")!.aliases.includes("mozzarella"));
  assert.ok(getIngredient("mozzarella")!.nutrients.fat > getIngredient("mozzarella-light")!.nutrients.fat);
  assert.ok(!getIngredient("whole-wheat-wrap")!.aliases.includes("piadina"));
  assert.ok(getIngredient("plain-wrap")!.aliases.includes("piadina"));
  assert.match(getIngredient("plain-wrap")!.state, /non integrale/);
  assert.match(getIngredient("brown-rice")!.state, /secco.*35-45/);
  assert.match(getIngredient("lean-beef")!.state, /crudo, macinato/);
  assert.match(getIngredient("ready-pancakes")!.state, /già cotti.*non pancake proteici/);
  assert.ok(getIngredient("jam")!.addedSugar! > 0);
  assert.equal(getIngredient("protein-bar")!.addedSugar, null);
  for (const allergen of ["fish", "crustaceans", "molluscs"]) {
    assert.ok(getIngredient("seafood-salad")!.allergens.includes(allergen));
  }
  for (const id of ["lean-beef", "white-fish", "seafood-salad", "smoked-salmon", "cooked-ham", "parmesan", "caciotta"]) {
    assert.equal(getIngredient(id)!.vegetarian, false, id);
  }
});

test("weekly compositions retain every applicable allergy and vegetarian exclusion", async () => {
  for (const fixture of fixtures) {
    const allergens = new Set(Object.keys(fixture.foods).flatMap((id) => getIngredient(id)!.allergens));
    for (const allergen of allergens) {
      const input = request(fixture);
      input.preferences.allergens = [allergen];
      assert.equal((await generateRecipe(input)).status, "infeasible", `${fixture.name}: ${allergen}`);
    }
    if (Object.keys(fixture.foods).some((id) => !getIngredient(id)!.vegetarian)) {
      const input = request(fixture);
      input.preferences.vegetarian = true;
      assert.equal((await generateRecipe(input)).status, "infeasible", fixture.name);
    }
  }
});

test("raw beef, cod, poultry and eggs cannot bypass a missing declared thermometer", async () => {
  for (const fixture of fixtures.filter((entry) => entry.safety)) {
    const input = request(fixture);
    input.preferences.equipment = ["pan", "stove"];
    const response = await generateRecipe(input);
    assert.equal(response.status, "infeasible", fixture.name);
    assert.match(response.details.join(" "), /termometro.*fisso/);
  }
});

test("ready compositions require no kitchen appliances; cooking compositions do", async () => {
  for (const fixture of fixtures) {
    const input = request(fixture);
    input.preferences.equipment = [];
    const template = TEMPLATES.find((entry) => entry.id === fixture.template)!;
    if (template.equipment.length) {
      assert.equal((await generateRecipe(input)).status, "infeasible", fixture.name);
    } else {
      const result = await recipe(input);
      verify(result, input);
      assert.ok(!/termometro|forno|microonde/.test(result.steps.map((step) => step.instruction).join(" ")));
    }
  }
});

test("brown rice does not become white rice, cooked weight, or a fast meal-prep promise", async () => {
  const fixture = fixtures.find((entry) => entry.template === "brown-rice-salmon")!;
  const input = request(fixture);
  input.preferences.maxTime = 35;
  assert.equal((await generateRecipe(input)).status, "infeasible");
  input.preferences.maxTime = 54;
  assert.equal((await generateRecipe(input)).status, "infeasible");
  input.preferences.maxTime = 55;
  const result = await recipe(input);
  assert.equal(result.minutes, 55);
  assert.match(result.steps.map((step) => step.instruction).join(" "), /35-45 minuti/);
  assert.ok(result.warnings.some((line) => /Riso integrale pesato secco/.test(line)));
  input.preferences.mealPrep = true;
  assert.equal((await generateRecipe(input)).status, "infeasible");
});

test("alternative foods are individually usable and never both forced or silently substituted", async () => {
  const groups: Array<Pick<Fixture, "foods" | "template">> = [
    { foods: { tomato: 123, bread: 58, mozzarella: 135, caciotta: 92 }, template: "tomato-cheese-bread" },
    { foods: { lettuce: 119, bread: 58, "white-fish": 175, "seafood-salad": 225 }, template: "white-fish-bread-salad" },
    { foods: { fennel: 137, bread: 58, chicken: 145, turkey: 145 }, template: "poultry-fennel-plate" },
  ];
  for (const fixture of groups) {
    const input = request({ ...fixture, name: "conflicting alternatives" });
    assert.equal((await generateRecipe(input)).status, "infeasible");
  }
});

test("beef and zucchini work without hidden binder; consented breadcrumbs/flour stay capped", async () => {
  const fixture = { name: "minimal beef", foods: { "lean-beef": 150, zucchini: 200 }, template: "beef-zucchini-patties" };
  const base = await recipe(request(fixture));
  assert.equal(base.ingredients.length, 2);
  assert.match(base.title, /manzo.*zucchine/);
  assert.match(base.steps.map((step) => step.instruction).join(" "), /macinato lega da solo, senza uovo/);
  for (const [id, cap] of [["breadcrumbs", 15], ["wheat-flour", 10]] as const) {
    for (const servings of [1, 2]) {
      const input = request(fixture, servings);
      input.pantry.push({ ingredientId: id, availableGrams: cap * servings, mode: "preferred" });
      const result = await recipe(input);
      verify(result, input);
      const extra = result.ingredients.find((item) => item.ingredientId === id)!;
      assert.ok(extra && extra.grams <= cap * servings);
      assert.equal(result.ingredients.length, 3);
      if (id === "wheat-flour") {
        assert.match(result.title, /infarinati/);
        assert.match(result.steps.at(-1)!.instruction, /farina rimasta.*cuocere completamente/);
      }
    }
    const tooMuch = request({ ...fixture, foods: { ...fixture.foods, [id]: cap + 1 } });
    assert.equal((await generateRecipe(tooMuch)).status, "infeasible");
  }
});

test("no cocoa, sugar, oil or other food is inferred; condiment additions are only from stock", async () => {
  const fixture = fixtures.find((entry) => entry.template === "cereal-yogurt-bowl")!;
  const input = request(fixture);
  input.pantry = input.pantry.filter((item) => item.ingredientId !== "cocoa");
  const breakfast = await recipe(input);
  assert.ok(!/cacao/i.test(breakfast.steps.slice(1).map((step) => step.instruction).join(" ")));
  assert.equal(breakfast.ingredients.length, 4);
  for (const template of ["beef-zucchini-patties", "tomato-parmesan-pasta", "brown-rice-salmon", "white-fish-bread-salad", "poultry-fennel-plate", "seafood-bread-salad", "tomato-cheese-bread", "egg-lettuce-wrap"]) {
    const fixture = fixtures.find((entry) => entry.template === template)!;
    const input = request(fixture);
    const allowed = TEMPLATES.find((entry) => entry.id === template)!.slots.flatMap((entry) => entry.ids);
    for (const [ingredientId, dietGrams] of Object.entries({ "olive-oil": 5, salt: 0.7, paprika: 1, lemon: 10 })) {
      if (allowed.includes(ingredientId)) input.pantry.push({ ingredientId, dietGrams, availableGrams: dietGrams, mode: "fixed" });
    }
    const result = await recipe(input);
    verify(result, input);
    assert.equal(result.fit.addedFatGrams, 5);
    assert.equal(result.steps.slice(1).filter((step) => step.instruction.includes("5 g di Olio extravergine di oliva")).length, 1);
  }
});

test("whey is a quantified drink, with fruit served alongside and explicit optional water", async () => {
  for (const fruit of ["apple", "banana", "strawberries", "berries"]) {
    const input = request({ name: "fruit+whey", foods: { [fruit]: 151.3, whey: 20 }, template: "whey-drink", sweet: true });
    const result = await recipe(input);
    verify(result, input);
    assert.equal(result.family, "bowl");
    assert.match(result.title, /Whey in acqua.*a lato/);
    assert.match(result.steps.at(-1)!.instruction, /160 ml di acqua potabile.*Servi separatamente/);
    assert.ok(!/dessert|mousse|pancake/.test(result.title));
  }
  const input = request({ name: "explicit water", foods: { whey: 25, water: 230, coffee: 37 }, template: "whey-drink", sweet: true });
  const result = await recipe(input);
  verify(result, input);
  assert.match(result.steps.at(-1)!.instruction, /230 g di Acqua/);
  assert.ok(!/ml di acqua/.test(result.steps.at(-1)!.instruction));
  const tooThick = request({ name: "insufficient fixed water", foods: { whey: 25, water: 40 }, template: "whey-drink", sweet: true });
  assert.equal((await generateRecipe(tooThick)).status, "infeasible");
});

test("product warnings, original inputs and numeric nutrition survive recipe serialization", async () => {
  for (const template of ["ready-pancake-breakfast", "cereal-yogurt-bowl", "fruit-protein-snack", "seafood-bread-salad", "tomato-cheese-bread"]) {
    const input = request(fixtures.find((entry) => entry.template === template)!);
    const result = await recipe(input);
    assert.ok(result.warnings.some((warning) => /Stime generiche dipendenti dal prodotto.*Non sono valori ufficiali/.test(warning)));
    const snapshot: Recipe = JSON.parse(JSON.stringify(result));
    assert.deepEqual(snapshot, result);
    const repeated = await recipe({ ...input, history: [result.fingerprint], nonce: "repeat" });
    if (template === "seafood-bread-salad") {
      assert.notEqual(repeated.templateId, result.templateId);
    } else {
      assert.ok(repeated.warnings.some((warning) => /Ripetizione esplicita/.test(warning)));
    }
    assert.deepEqual(snapshot, result);
  }
});

test("fixed low-protein breakfasts cannot acquire false FIT claims or violate calorie limits", async () => {
  for (const template of ["ready-pancake-breakfast", "tomato-parmesan-pasta"]) {
    const input = request(fixtures.find((entry) => entry.template === template)!);
    const result = await recipe(input);
    assert.ok(result.fit.proteinEnergyPercentage < 25);
    input.preferences.highProtein = true;
    assert.equal((await generateRecipe(input)).status, "infeasible");
    input.preferences.highProtein = false;
    input.targets.kcal = 100;
    input.targets.strictCalories = true;
    assert.equal((await generateRecipe(input)).status, "infeasible");
    input.targets.strictCalories = false;
    const closest = await recipe(input);
    assert.equal(closest.targetStatus, "closest");
    assert.deepEqual(closest.ingredients, result.ingredients);
  }
});

const chefTemplates = ["poultry-fennel-crunch", "poultry-fennel-tartines"];
const chefExtras = { "greek-yogurt": 40, lemon: 15, paprika: 1, "olive-oil": 5 };

function chefRequest(protein: "chicken" | "turkey", servings: number, extras: boolean): GenerateRequest {
  const input = request({
    name: "poultry bread transformation",
    foods: { [protein]: 200, fennel: 200, bread: 70 },
    template: "poultry-fennel-crunch",
  }, servings);
  input.preferences.maxTime = 35;
  input.preferences.equipment = ["pan", "stove", "thermometer"];
  if (extras) {
    for (const [ingredientId, cap] of Object.entries(chefExtras)) {
      input.pantry.push({ ingredientId, availableGrams: cap * servings, dietGrams: cap, mode: "preferred" });
    }
  }
  return input;
}

async function chefPair(input: GenerateRequest): Promise<Recipe[]> {
  const first = await recipe(input);
  const second = await recipe({
    ...input, history: [first.fingerprint], nonce: "another-poultry-technique",
    variant: {
      kind: "another", baselineNutrition: first.nutritionPerServing,
      baselineMinutes: first.minutes, baselineRecipeId: first.id,
    },
  });
  assert.deepEqual([first.templateId, second.templateId].sort(), [...chefTemplates].sort());
  assert.notEqual(first.technique, second.technique);
  assert.notEqual(first.family, second.family);
  assert.notEqual(first.fingerprint.structuralSignature, second.fingerprint.structuralSignature);
  assert.notDeepEqual(first.steps, second.steps);
  assert.ok(!second.warnings.some((warning) => /Ripetizione esplicita/.test(warning)));
  return [first, second];
}

test("chef poultry: two real transformations without extras, fixed amounts and one/two servings", async () => {
  for (const protein of ["chicken", "turkey"] as const) {
    for (const servings of [1, 2]) {
      const input = chefRequest(protein, servings, false);
      const before = structuredClone(input);
      for (const result of await chefPair(input)) {
        verify(result, input);
        assert.deepEqual(result.ingredients.map((item) => item.ingredientId).sort(), [protein, "fennel", "bread"].sort());
        assert.equal(result.fit.addedFatGrams, 0);
        assert.match(result.title, protein === "chicken" ? /pollo/i : /tacchino/i);
        const steps = result.steps.slice(1).map((step) => step.instruction).join(" ");
        assert.match(steps, /74 °C.*termometro alimentare/);
        assert.ok(!/yogurt|paprika|limone|pangrattato/i.test(steps), steps);
        if (result.templateId === "poultry-fennel-crunch") {
          assert.match(steps, /crumble grossolano.*crostini/);
          assert.ok(steps.includes(`${formatGrams(35 * servings)} per un crumble`));
          assert.ok(steps.includes(`restanti ${formatGrams(35 * servings)} per crostini`));
          assert.match(steps, /padella antiaderente asciutta.*prima che.*carne cruda/);
          assert.match(steps, /lamelle sottilissime.*Massaggia/);
          assert.match(steps, /intero crumble sulla carne.*tutti i crostini sulla slaw/);
        } else {
          assert.match(steps, /fette spesse circa 1 cm.*circa 2 minuti per lato/);
          assert.match(steps, /lascia prendere colore.*copri e cuoci altri 5 minuti/);
          assert.match(steps, /sfilaccia con due forchette pulite/);
          assert.match(steps, /tutta la farcitura sulle fette tostate/);
        }
      }
      assert.deepEqual(input, before);
    }
  }
});

test("chef poultry: every confirmed extra is used meaningfully, never above consent, in both techniques", async () => {
  for (const protein of ["chicken", "turkey"] as const) {
    for (const servings of [1, 2]) {
      const input = chefRequest(protein, servings, true);
      for (const result of await chefPair(input)) {
        verify(result, input);
        assert.equal(result.ingredients.length, 7);
        for (const [ingredientId, cap] of Object.entries(chefExtras)) {
          assert.equal(result.ingredients.find((item) => item.ingredientId === ingredientId)!.grams, cap * servings);
        }
        const cooking = result.steps.slice(1);
        assert.equal(cooking.filter((step) => step.instruction.includes(`${formatGrams(5 * servings)} di Olio extravergine di oliva`)).length, 1);
        const creamStep = cooking.find((step) => step.instruction.includes(`${formatGrams(40 * servings)} di Yogurt greco 0%`))!.instruction;
        assert.ok(creamStep.includes(`${formatGrams(15 * servings)} di Succo di limone`));
        if (result.templateId === "poultry-fennel-crunch") {
          assert.match(creamStep, /Versa tutto sui finocchi e massaggia/);
          assert.match(cooking[0].instruction, /pane tostato con .*Paprika/);
        } else {
          assert.match(creamStep, /incorpora l'intero condimento alla carne sfilacciata e ai finocchi/);
          assert.match(creamStep, /non essere servito a lato/);
        }
        assert.equal(result.fit.addedFatGrams, 5);
        assert.deepEqual(result.nutritionTotal, calculateNutrition(result.ingredients));
      }
    }
  }
});

test("chef poultry supports explicitly fixed dressing weights and restriction-filtered extras", async () => {
  const fixed = chefRequest("chicken", 1, true);
  fixed.pantry.forEach((item) => { item.mode = "fixed"; });
  for (const result of await chefPair(fixed)) verify(result, fixed);

  const noDairy = chefRequest("turkey", 2, true);
  noDairy.preferences.allergens = ["milk"];
  noDairy.preferences.maxAddedFatGrams = 0;
  for (const result of await chefPair(noDairy)) {
    verify(result, noDairy);
    assert.ok(!result.ingredients.some((item) => ["greek-yogurt", "olive-oil"].includes(item.ingredientId)));
    assert.ok(result.ingredients.some((item) => item.ingredientId === "lemon"));
    assert.ok(result.ingredients.some((item) => item.ingredientId === "paprika"));
    assert.ok(!/yogurt/i.test(result.title));
  }
  const optionalButIncompatible = chefRequest("chicken", 1, false);
  optionalButIncompatible.pantry.push({ ingredientId: "coffee", availableGrams: 100, mode: "preferred" });
  for (const result of await chefPair(optionalButIncompatible)) {
    assert.equal(result.ingredients.length, 3, "Preferred foods are still not mandatory in the optimizer.");
  }
});

test("chef poultry keeps stock, allergens, tools, time and hard dietary constraints", async () => {
  const failures: Array<(input: GenerateRequest) => void> = [
    (input) => { input.preferences.equipment = ["pan", "stove"]; },
    (input) => { input.preferences.equipment = ["pan", "thermometer"]; },
    (input) => { input.preferences.equipment = ["stove", "thermometer"]; },
    (input) => { input.preferences.allergens = ["gluten"]; },
    (input) => { input.preferences.vegetarian = true; },
    (input) => { input.preferences.excludedIngredientIds = ["fennel"]; },
    (input) => { input.preferences.maxTime = 24; },
    (input) => { input.targets.kcal = 100; input.targets.strictCalories = true; },
    (input) => { input.pantry.find((item) => item.ingredientId === "bread")!.availableGrams -= 1; },
  ];
  for (const mutate of failures) {
    const input = chefRequest("chicken", 1, true);
    mutate(input);
    assert.equal((await generateRecipe(input)).status, "infeasible");
  }
  const twoServings = chefRequest("chicken", 2, false);
  for (const result of await chefPair(twoServings)) assert.equal(result.minutes, 35);
});

test("chef poultry prioritizes transformations but preserves the shorter legacy recipe and its snapshot", async () => {
  const limited = chefRequest("chicken", 1, false);
  limited.preferences.maxTime = 25;
  const legacy = await recipe(limited);
  assert.equal(legacy.templateId, "poultry-fennel-plate");
  const snapshot = JSON.parse(JSON.stringify(legacy));
  const current = chefRequest("chicken", 1, true);
  current.history = [legacy.fingerprint];
  const improved = await recipe(current);
  assert.ok(chefTemplates.includes(improved.templateId));
  assert.deepEqual(legacy, snapshot);
  for (const nonce of ["chef-a", "chef-b", "chef-c"]) {
    const result = await recipe({ ...chefRequest("chicken", 1, false), nonce });
    assert.ok(chefTemplates.includes(result.templateId), "Plain plate should not win a nonce tie.");
  }
});
