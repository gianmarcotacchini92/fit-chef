import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogFood, diaryEntrySchema, entryNutrition, localDate, savedMealSchema, sumDiary, type DiaryEntry,
} from "../src/lib/nutrition-diary";

function entry(overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: "entry-1", date: "2026-10-06", meal: "lunch", food: catalogFood("rice"), grams: 150,
    createdAt: "2026-10-06T12:00:00.000Z", ...overrides,
  };
}

test("catalogFood snapshots per-100g values and honest provenance from the curated catalog", () => {
  const rice = catalogFood("rice");
  assert.equal(rice.id, "rice");
  assert.equal(rice.name, "Riso");
  assert.deepEqual(rice.per100g, { kcal: 356, protein: 7, carbs: 79, fat: .7, fiber: 1 });
  assert.match(rice.source, /Stima editoriale/);
  assert.equal(rice.barcode, undefined);
});

test("catalogFood throws rather than fabricating an unknown ingredient", () => {
  assert.throws(() => catalogFood("does-not-exist"), /non trovato/);
});

test("entryNutrition scales per-100g values exactly by grams/100", () => {
  const nutrition = entryNutrition(entry({ grams: 150 }));
  assert.equal(nutrition.kcal, 534);
  assert.equal(nutrition.protein, 10.5);
  assert.equal(nutrition.carbs, 118.5);
  assert.ok(Math.abs(nutrition.fat - 1.05) < 1e-9);
  assert.equal(nutrition.fiber, 1.5);
  const half = entryNutrition(entry({ grams: 50 }));
  assert.equal(half.kcal, 178);
});

test("localDate formats the local calendar day as YYYY-MM-DD, not a UTC-shifted ISO string", () => {
  const date = new Date(2026, 0, 5, 23, 30); // local 5 Jan 23:30 â€” a naive UTC conversion could roll to the 6th or stay on the 4th depending on zone
  assert.equal(localDate(date), "2026-01-05");
  const padded = new Date(2026, 8, 1, 0, 0);
  assert.equal(localDate(padded), "2026-09-01");
});

test("sumDiary filters strictly by the real calendar date and groups totals per meal", () => {
  const entries = [
    entry({ id: "a", date: "2026-10-06", meal: "breakfast", food: catalogFood("oats"), grams: 80 }),
    entry({ id: "b", date: "2026-10-06", meal: "lunch", food: catalogFood("rice"), grams: 150 }),
    entry({ id: "c", date: "2026-10-07", meal: "lunch", food: catalogFood("rice"), grams: 150 }),
  ];
  const result = sumDiary(entries, "2026-10-06");
  assert.equal(result.meals.breakfast.kcal, 300);
  assert.equal(result.meals.lunch.kcal, 534);
  assert.equal(result.meals.dinner.kcal, 0);
  assert.equal(result.meals.snack.kcal, 0);
  assert.equal(result.total.kcal, 834);
  assert.equal(sumDiary(entries, "2026-10-07").total.kcal, 534);
  assert.equal(sumDiary([], "2026-10-06").total.kcal, 0);
});

test("sumDiary defaults to today when no date is given", () => {
  const today = localDate();
  const result = sumDiary([entry({ date: today })], undefined);
  assert.equal(result.total.kcal, 534);
});

test("diaryEntrySchema rejects timezone-impossible or malformed dates", () => {
  assert.equal(diaryEntrySchema.safeParse(entry({ date: "2026-02-30" })).success, false);
  assert.equal(diaryEntrySchema.safeParse(entry({ date: "2026-13-01" })).success, false);
  assert.equal(diaryEntrySchema.safeParse(entry({ date: "06-10-2026" })).success, false);
  assert.equal(diaryEntrySchema.safeParse(entry({ date: "2026-10-06" })).success, true);
});

test("diaryEntrySchema bounds grams strictly above zero and at most 5000", () => {
  assert.equal(diaryEntrySchema.safeParse(entry({ grams: 0 })).success, false);
  assert.equal(diaryEntrySchema.safeParse(entry({ grams: -5 })).success, false);
  assert.equal(diaryEntrySchema.safeParse(entry({ grams: 5000 })).success, true);
  assert.equal(diaryEntrySchema.safeParse(entry({ grams: 5000.1 })).success, false);
  assert.equal(diaryEntrySchema.safeParse(entry({ grams: Infinity })).success, false);
  assert.equal(diaryEntrySchema.safeParse(entry({ grams: NaN })).success, false);
});

test("diaryEntrySchema rejects non-finite or out-of-range nutrient values in a custom food snapshot", () => {
  const custom = entry({ food: { id: "manual-1", name: "Mix", state: "pronto", source: "utente", per100g: { kcal: Infinity, protein: 1, carbs: 1, fat: 1, fiber: 1 } } });
  assert.equal(diaryEntrySchema.safeParse(custom).success, false);
  const negative = entry({ food: { id: "manual-1", name: "Mix", state: "pronto", source: "utente", per100g: { kcal: -5, protein: 1, carbs: 1, fat: 1, fiber: 1 } } });
  assert.equal(diaryEntrySchema.safeParse(negative).success, false);
});

test("diaryEntrySchema keeps a barcode only when it is digits, and is otherwise absent", () => {
  const withBarcode = entry({ food: { ...catalogFood("rice"), barcode: "8001234567890" } });
  assert.equal(diaryEntrySchema.safeParse(withBarcode).success, true);
  const badBarcode = entry({ food: { ...catalogFood("rice"), barcode: "not-a-code" } });
  assert.equal(diaryEntrySchema.safeParse(badBarcode).success, false);
});

test("diaryEntrySchema rejects unknown extra fields (no silent schema drift)", () => {
  assert.equal(diaryEntrySchema.safeParse({ ...entry(), extra: true }).success, false);
});

test("savedMealSchema requires at least one item and validates every food and quantity", () => {
  const meal = { id: "meal-1", name: "Pranzo tipo", createdAt: "2026-10-06T12:00:00.000Z", items: [{ food: catalogFood("pasta"), grams: 85 }] };
  assert.equal(savedMealSchema.safeParse(meal).success, true);
  assert.equal(savedMealSchema.safeParse({ ...meal, items: [] }).success, false);
  assert.equal(savedMealSchema.safeParse({ ...meal, items: [{ food: catalogFood("pasta"), grams: -1 }] }).success, false);
});
