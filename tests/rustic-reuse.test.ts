import assert from "node:assert/strict";
import test from "node:test";
import { rusticReuseGrams } from "../src/lib/rustic-pie";
import { foodSnapshotSchema, catalogFood } from "../src/lib/nutrition-diary";
import { splitMealText, parseSmartMeal } from "../src/lib/smart-meal";
const food = { ...catalogFood("rice"), id: "personal-rustic-test", name: "La mia torta rustica alla ricotta",
  source: "Stima. Porzione salvata: 220 g per 2 fette." };

test("reuse requires a current quantity and confirmation, known mass wins", () => {
  assert.equal(rusticReuseGrams(food, 3, null, true), 330);
  assert.equal(rusticReuseGrams(food, 0, null, true), null);
  assert.equal(rusticReuseGrams(food, 2, null, false), null);
  assert.equal(rusticReuseGrams(food, 0, 180, true), 180);
  assert.equal(rusticReuseGrams(food, 3, NaN, true), null);
  assert.equal(rusticReuseGrams({ ...food, source: "Porzione salvata: 220 g per 0 fette." }, 2, null, true), null);
});

test("versioned portions roundtrip, override legacy prose and allow weight-only saves", () => {
  const saved = foodSnapshotSchema.parse(JSON.parse(JSON.stringify({ ...food,
    rusticPortion: { version: 1, grams: 180, slices: 2, size: "small", measured: true } })));
  assert.equal(rusticReuseGrams(saved, 3, null, true), 270);
  assert.equal(rusticReuseGrams({ ...saved, rusticPortion: { ...saved.rusticPortion!, slices: null } }, 2, null, true), null);
  assert.equal(foodSnapshotSchema.safeParse({ ...saved, rusticPortion: { ...saved.rusticPortion, grams: -1 } }).success, false);
  assert.equal(foodSnapshotSchema.safeParse(food).success, true);
});

test("shared splitting keeps decimal commas and suffix quantities without dropping other foods", () => {
  for (const separator of [", ", " e ", " + ", "; ", "\n"]) {
    assert.deepEqual(splitMealText(`2 fette di torta rustica${separator}150 g pollo`), ["2 fette di torta rustica", "150 g pollo"]);
  }
  assert.deepEqual(splitMealText("torta rustica, 2 fette, 150 g pollo"), ["torta rustica 2 fette", "150 g pollo"]);
  assert.equal(parseSmartMeal("100,5 g riso").items[0].grams, 100.5);
});

test("saved foods with explicit mass precede generic dishes and ambiguous names block", () => {
  assert.equal(parseSmartMeal(`200 g ${food.name}`, [food]).items[0].food.id, food.id);
  assert.equal(parseSmartMeal(`200 g ${food.name}`, [food]).items[0].grams, 200);
  const duplicate = { ...food, id: "personal-rustic-other" };
  assert.equal(parseSmartMeal(`200 g ${food.name}`, [food, duplicate]).items.length, 0);
  const pizza = { ...food, name: "Pizza margherita" };
  assert.equal(parseSmartMeal("200 g Pizza margherita", [pizza]).items[0].food.id, food.id);
});
