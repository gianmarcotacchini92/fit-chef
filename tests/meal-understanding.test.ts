import assert from "node:assert/strict";
import test from "node:test";
import { catalogFood, foodSnapshotSchema } from "../src/lib/nutrition-diary";
import { mealCandidates, mealPhrases, mealQuantity, resolveMealPhrase, validateMealLanguage, isPilotRusticPhrase } from "../src/lib/meal-understanding";

test("quantities support mass units, decimals, suffixes and everyday counts without fabricated weights", () => {
  for (const [phrase, grams] of [["ho mangiato 0,2 kg di pollo", 200], ["riso 90 g", 90], ["1.5 hg pane", 150]] as const) assert.equal(mealQuantity(phrase).grams, grams);
  assert.equal(mealQuantity("due uova").count, 2);
  assert.equal(mealQuantity("un bicchiere di latte").count, 1);
  assert.equal(mealQuantity("250 ml latte").grams, null);
  assert.equal(mealQuantity("-200 g pollo").invalid, true);
  assert.equal(mealQuantity("6000 g pollo").invalid, true);
});

test("catalog-wide matching asks only for missing quantity and suggests typos without silent substitutions", () => {
  assert.equal(resolveMealPhrase("Ho mangiato 150 g pollo", []).food?.id, "chicken");
  assert.equal(resolveMealPhrase("due uova", []).food?.id, "eggs");
  assert.equal(resolveMealPhrase("due uova", []).grams, null);
  assert.ok(mealCandidates("mozzarela", []).some(f => f.id === "mozzarella"));
  assert.equal(resolveMealPhrase("100 g mozzarela", []).food, null);
  assert.equal(resolveMealPhrase("200 g pasta al pesto", []).food, null);
  assert.equal(resolveMealPhrase("200 g pasta al pesto", [], "pasta").food, null);
  assert.equal(resolveMealPhrase("200 g pollo cotto", []).food, null);
});

test("confirmed names persist and reuse nutrition but never old quantities", () => {
  const food = foodSnapshotSchema.parse({ ...catalogFood("rice"), id: "personal-rice", mealAliases: ["riso di casa"] });
  const stored = foodSnapshotSchema.parse(JSON.parse(JSON.stringify(food)));
  assert.equal(resolveMealPhrase("120 g riso di casa", [stored]).food?.id, "personal-rice");
  assert.equal(resolveMealPhrase("120 g riso di casa", [stored]).grams, 120);
  assert.equal(resolveMealPhrase("riso di casa", [stored]).grams, null);
  assert.equal(resolveMealPhrase("120 g riso di casa", [stored, { ...stored, id: "duplicate" }]).food, null);
});

test("supported estimates and mixed meals remain available while richer rustic fillings stay unresolved", () => {
  assert.equal(resolveMealPhrase("2 pezzi di pizza crostino", []).grams, 200);
  assert.equal(resolveMealPhrase("4 polpette in bianco", []).grams, 180);
  assert.equal(resolveMealPhrase("2 pezzi di pizza con patate", []).grams, 200);
  assert.equal(resolveMealPhrase("pizza crostino due pezzi", []).grams, 200);
  assert.equal(resolveMealPhrase("0,2 kg pizza crostino", []).grams, 200);
  assert.deepEqual(mealPhrases("90,5 g riso e 150 g pollo + due uova"), ["90.5 g riso", "150 g pollo", "due uova"]);
  assert.equal(isPilotRusticPhrase("2 fette di torta rustica alla ricotta"), true);
  assert.equal(isPilotRusticPhrase("2 fette di torta rustica con bacon"), false);
});

test("AI output must preserve every character and cannot hide food as context or return nutrients", () => {
  const input = "Ho mangiato due uova e un panino";
  const good = { segments: [
    { text: "Ho mangiato ", kind: "context", query: "" }, { text: "due uova", kind: "food", query: "uova" },
    { text: " e ", kind: "context", query: "" }, { text: "un panino", kind: "food", query: "panino" },
  ] };
  assert.equal(validateMealLanguage(good, input).segments.length, 4);
  assert.throws(() => validateMealLanguage({ segments: good.segments.slice(0, 2) }, input));
  assert.throws(() => validateMealLanguage({ segments: good.segments.map(s => s.text === "un panino" ? { ...s, kind: "context" } : s) }, input));
  assert.throws(() => validateMealLanguage({ ...good, kcal: 100 }, input));
  assert.throws(() => validateMealLanguage({ segments: [{ text: input, kind: "food", query: "", grams: 100 }] }, input));
});
