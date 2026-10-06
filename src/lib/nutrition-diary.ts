import { z } from "zod";
import { getIngredient } from "./catalog";
import type { Nutrients, WeekMeal } from "./types";

// Standalone schemas: this module must not import ./validation (validation.ts imports from here).
const text = (max: number) => z.string().min(1).max(max).refine(
  (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
  "Il testo contiene caratteri non validi.",
);
const finite = (max: number) => z.number().finite().min(0).max(max);
const id = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_.:-]+$/, "Identificativo non valido.");
const grams = z.number().finite().positive().max(5_000);
const isoDateTime = z.iso.datetime({ offset: true });
const weekMeal = z.enum(["breakfast", "lunch", "snack", "dinner"]);

function isRealLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** YYYY-MM-DD matching a real calendar date, so a stored date always means the same local day regardless of timezone. */
const diaryDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa il formato AAAA-MM-GG.").refine(isRealLocalDate, "Questa data non esiste nel calendario.");

export const nutrientsSchema = z.strictObject({
  kcal: finite(1_000_000),
  protein: finite(100_000),
  carbs: finite(100_000),
  fat: finite(100_000),
  fiber: finite(100_000),
});

export const foodSnapshotSchema = z.strictObject({
  id,
  name: text(160),
  state: text(220),
  source: text(2_000),
  per100g: nutrientsSchema,
  barcode: z.string().regex(/^\d{4,20}$/, "Il codice a barre deve contenere solo cifre.").optional(),
});

export const diaryEntrySchema = z.strictObject({
  id,
  date: diaryDate,
  meal: weekMeal,
  food: foodSnapshotSchema,
  grams,
  createdAt: isoDateTime,
});

export const savedMealSchema = z.strictObject({
  id,
  name: text(160),
  items: z.array(z.strictObject({ food: foodSnapshotSchema, grams })).min(1).max(60),
  createdAt: isoDateTime,
});

export type FoodSnapshot = z.infer<typeof foodSnapshotSchema>;
export type DiaryEntry = z.infer<typeof diaryEntrySchema>;
export type SavedMeal = z.infer<typeof savedMealSchema>;

/** Local calendar date (not UTC), so entries logged late at night land on the day the user actually sees. */
export function localDate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const emptyNutrients = (): Nutrients => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
function addNutrients(left: Nutrients, right: Nutrients): Nutrients {
  return {
    kcal: left.kcal + right.kcal,
    protein: left.protein + right.protein,
    carbs: left.carbs + right.carbs,
    fat: left.fat + right.fat,
    fiber: left.fiber + right.fiber,
  };
}

/** Quantity actually eaten: the food's per-100g values scaled by the logged grams. */
export function entryNutrition(entry: DiaryEntry): Nutrients {
  const factor = entry.grams / 100;
  const per100g = entry.food.per100g;
  return {
    kcal: per100g.kcal * factor,
    protein: per100g.protein * factor,
    carbs: per100g.carbs * factor,
    fat: per100g.fat * factor,
    fiber: per100g.fiber * factor,
  };
}

const MEALS: WeekMeal[] = ["breakfast", "lunch", "snack", "dinner"];

/** Totals and per-meal breakdown for a single real day (defaults to today, in local time). */
export function sumDiary(entries: DiaryEntry[], date: string = localDate()): { total: Nutrients; meals: Record<WeekMeal, Nutrients> } {
  const meals = Object.fromEntries(MEALS.map((meal) => [meal, emptyNutrients()])) as Record<WeekMeal, Nutrients>;
  let total = emptyNutrients();
  for (const entry of entries) {
    if (entry.date !== date) continue;
    const nutrition = entryNutrition(entry);
    meals[entry.meal] = addNutrients(meals[entry.meal], nutrition);
    total = addNutrients(total, nutrition);
  }
  return { total, meals };
}

/** Generic catalog snapshot: honest provenance from the curated catalog, per 100 g in the stated state. Throws for an unknown id so callers never silently log a made-up food. */
export function catalogFood(ingredientId: string): FoodSnapshot {
  const ingredient = getIngredient(ingredientId);
  if (!ingredient) throw new Error(`Alimento del catalogo non trovato: ${ingredientId}.`);
  return {
    id: ingredient.id,
    name: ingredient.name,
    state: ingredient.state,
    source: ingredient.source,
    per100g: ingredient.nutrients,
  };
}
