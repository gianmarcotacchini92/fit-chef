import { getIngredient } from "./catalog";
import { minimumDailyProtein } from "./nutrition-profile";
import { emptyWeeklyDraft, selectedWeeklyOption, weeklyMealKey, weeklyQuantityKey, WEEK_MEALS } from "./weekly-diet";
import type { WeekDay, WeekMeal, WeeklyDietState, WeeklySlot, WeeklyOption } from "./types";

export type PlannedItem = {
  meal: WeekMeal; slotId: string; label: string; ingredientId: string;
  grams: number; originalGrams: number; quantityKey: string; locked: boolean;
  kcalPerGram: number; proteinPerGram: number;
};
export type DailyPlan = { items: PlannedItem[]; errors: string[]; kcal: number; protein: number };
export type DailyAdjustment = {
  items: PlannedItem[]; kcal: number; protein: number; minimumProtein: number;
  reached: boolean; message: string;
};

function numericGrams(slot: WeeklySlot, option: WeeklyOption, grams: Record<string, string>, overrides?: Record<string, string>): number {
  const raw = option.grams === null ? grams[weeklyQuantityKey(slot, option)] : (overrides?.[weeklyQuantityKey(slot, option)] ?? String(option.grams));
  return raw.trim() ? Number(raw.replace(",", ".")) : NaN;
}

export function plannedDay(state: WeeklyDietState, day: WeekDay, lockedKeys: ReadonlySet<string> = new Set()): DailyPlan {
  const items: PlannedItem[] = [];
  const errors: string[] = [];
  if (!state.plan) return { items, errors: ["Importa prima un piano privato."], kcal: 0, protein: 0 };
  for (const { id: meal } of WEEK_MEALS) {
    const plan = state.plan[day][meal];
    if (plan.freeChoice) {
      errors.push(`${meal}: pasto libero da quantificare manualmente; non è incluso nel ricalcolo.`);
      continue;
    }
    const draft = state.drafts[weeklyMealKey(day, meal)] ?? emptyWeeklyDraft();
    for (const slot of plan.slots) {
      const option = selectedWeeklyOption(slot, draft);
      if (!option) { errors.push(`${slot.label}: seleziona un'alternativa.`); continue; }
      const food = getIngredient(option.ingredientId);
      if (!food) { errors.push(`${slot.label}: alimento non trovato nel catalogo.`); continue; }
      const grams = numericGrams(slot, option, draft.grams, draft.overrides);
      if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) {
        errors.push(`${slot.label}: inserisci grammi validi.`); continue;
      }
      const quantityKey = weeklyQuantityKey(slot, option);
      const lockKey = `${meal}:${quantityKey}`;
      items.push({
        meal, slotId: slot.id, label: slot.label, ingredientId: option.ingredientId,
        quantityKey, grams, originalGrams: grams, locked: lockedKeys.has(lockKey),
        kcalPerGram: food.nutrients.kcal / 100, proteinPerGram: food.nutrients.protein / 100,
      });
    }
  }
  return {
    items, errors, kcal: items.reduce((n, x) => n + x.grams * x.kcalPerGram, 0),
    protein: items.reduce((n, x) => n + x.grams * x.proteinPerGram, 0),
  };
}

/**
 * Deterministic bounded 5 g coordinate search, not a medical recommendation.
 * Incomplete days are rejected, not treated as zero-calorie meals.
 * Keeps each quantity between 50-150% of its current value, respects locks,
 * and only marks a proposed day ready when kcal is within 25 and protein >= 1.6 g/kg.
 */
export function adjustPlannedDay(day: DailyPlan, kcalTarget: number, weightKg: number): DailyAdjustment {
  const minProtein = minimumDailyProtein(weightKg);
  if (day.errors.length) throw new Error(day.errors.join(" "));
  if (!Number.isFinite(kcalTarget) || kcalTarget <= 0 || kcalTarget > 10000)
    throw new Error("Indica un obiettivo calorico valido.");
  if (!day.items.length) throw new Error("La giornata non contiene alimenti.");
  const items = day.items.map(item => ({ ...item }));
  const bounds = items.map(item => ({
    lower: item.locked ? item.grams : Math.max(0.1, Math.round(item.grams * 0.5 / 5) * 5),
    upper: item.locked ? item.grams : Math.min(5000, Math.round(item.grams * 1.5 / 5) * 5),
  }));
  let kcal = day.kcal;
  let protein = day.protein;
  // First ensure protein floor (prefer greatest protein per kcal to avoid needless energy).
  for (let step = 0; step < 5000 && protein + 1e-7 < minProtein; step++) {
    let best = -1, score = -Infinity;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.locked || item.proteinPerGram <= 0 || item.grams + 5 > bounds[i].upper + 1e-8) continue;
      const ratio = item.proteinPerGram / Math.max(0.01, item.kcalPerGram);
      if (ratio > score) { best = i; score = ratio; }
    }
    if (best < 0) break;
    items[best].grams += 5;
    kcal += 5 * items[best].kcalPerGram;
    protein += 5 * items[best].proteinPerGram;
  }
  // Then approach kcal target without violating minimum protein.
  for (let step = 0; step < 5000; step++) {
    let best = -1, bestDelta = 0;
    let bestScore = Math.abs(kcal - kcalTarget);
    for (let i = 0; i < items.length; i++) {
      if (items[i].locked) continue;
      for (const delta of [-5, 5]) {
        const next = items[i].grams + delta;
        if (next < bounds[i].lower - 1e-8 || next > bounds[i].upper + 1e-8 || next <= 0) continue;
        if (protein + delta * items[i].proteinPerGram < minProtein - 1e-7) continue;
        const score = Math.abs(kcal + delta * items[i].kcalPerGram - kcalTarget);
        if (score + 0.001 < bestScore) { best = i; bestDelta = delta; bestScore = score; }
      }
    }
    if (best < 0) break;
    items[best].grams += bestDelta;
    kcal += bestDelta * items[best].kcalPerGram;
    protein += bestDelta * items[best].proteinPerGram;
  }
  const reached = Math.abs(kcal - kcalTarget) <= 25 && protein + 1e-7 >= minProtein;
  return {
    items, kcal, protein, minimumProtein: minProtein, reached,
    message: reached ? "Anteprima entro ±25 kcal e sopra il minimo proteico. Verifica le porzioni prima di applicare."
      : `Non è stata trovata una combinazione entro ±25 kcal e ${minProtein} g di proteine mantenendo i blocchi e le porzioni tra 50% e 150%. Sblocca alimenti o rivedi i target.`,
  };
}

/** Overrides only the current day's draft quantities, leaving the imported prescription unchanged. */
export function applyDailyAdjustment(state: WeeklyDietState, day: WeekDay, proposal: DailyAdjustment): WeeklyDietState {
  if (!proposal.reached) throw new Error("La proposta non soddisfa i vincoli impostati.");
  const drafts = { ...state.drafts };
  for (const item of proposal.items) {
    const key = weeklyMealKey(day, item.meal);
    const previous = drafts[key] ?? emptyWeeklyDraft();
    drafts[key] = {
      ...previous,
      confirmed: false,
      ...(state.plan?.[day][item.meal].slots.find((slot) => slot.id === item.slotId)?.options.find((opt) => opt.ingredientId === item.ingredientId)?.grams === null
        ? { grams: { ...previous.grams, [item.quantityKey]: String(Math.round(item.grams * 10) / 10) } }
        : { overrides: { ...previous.overrides, [item.quantityKey]: String(Math.round(item.grams * 10) / 10) } }),
    };
  }
  return { ...state, drafts };
}
