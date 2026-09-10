import { getIngredient } from "./catalog";
import { createMealBase, ingredientRestriction } from "./meal";
import { weeklyPlanSchema } from "./validation";
import type { PantryItem, RecipeInput, WeekDay, WeekMeal, WeeklyDietState, WeeklyMeal, WeeklyMealDraft, WeeklyOption, WeeklyPlan, WeeklySlot } from "./types";

export const WEEK_DAYS: { id: WeekDay; label: string; short: string }[] = [
  { id: "monday", label: "Lunedì", short: "Lun" },
  { id: "tuesday", label: "Martedì", short: "Mar" },
  { id: "wednesday", label: "Mercoledì", short: "Mer" },
  { id: "thursday", label: "Giovedì", short: "Gio" },
  { id: "friday", label: "Venerdì", short: "Ven" },
  { id: "saturday", label: "Sabato", short: "Sab" },
  { id: "sunday", label: "Domenica", short: "Dom" },
];
export const WEEK_MEALS: { id: WeekMeal; label: string }[] = [
  { id: "breakfast", label: "Colazione" }, { id: "lunch", label: "Pranzo" },
  { id: "snack", label: "Spuntino" }, { id: "dinner", label: "Cena" },
];
export const WEEKLY_PLAN_FILE_LIMIT = 512 * 1024;

export function initialWeeklyDietState(): WeeklyDietState {
  return { version: 1, day: "monday", meal: "lunch", drafts: {} };
}

export function parseWeeklyPlanJson(contents: string): WeeklyPlan {
  if (new TextEncoder().encode(contents).byteLength > WEEKLY_PLAN_FILE_LIMIT) throw new Error("Il file del piano supera 512 KB.");
  let value: unknown;
  try { value = JSON.parse(contents); }
  catch { throw new Error("Il file non contiene JSON valido."); }
  const parsed = weeklyPlanSchema.safeParse(value);
  if (!parsed.success) throw new Error("Piano non valido: servono 7 giorni con 4 pasti, alimenti e quantita valide. Importa solo il JSON del piano, non un archivio completo.");
  return parsed.data;
}

/** Explicit replacement never reuses choices or confirmation from an unrelated plan. */
export function replaceWeeklyPlan(state: WeeklyDietState, plan: WeeklyPlan): WeeklyDietState {
  return { version: state.version, day: state.day, meal: state.meal, plan: weeklyPlanSchema.parse(plan), drafts: {} };
}

/** Only for the original local workspace: attach its private plan without losing legacy drafts. */
export function migrateWeeklyPlan(state: WeeklyDietState, plan: WeeklyPlan): WeeklyDietState {
  return state.plan ? state : { ...state, plan: weeklyPlanSchema.parse(plan) };
}

export const emptyWeeklyDraft = (): WeeklyMealDraft => ({ choices: {}, grams: {}, confirmed: false });
export const weeklyMealKey = (day: WeekDay, meal: WeekMeal) => `${day}-${meal}`;
export function selectedWeeklyOption(slot: WeeklySlot, draft: WeeklyMealDraft): WeeklyOption | undefined {
  return slot.options.length === 1 ? slot.options[0] : slot.options.find((option) => option.ingredientId === draft.choices[slot.id]);
}
export const weeklyQuantityKey = (slot: WeeklySlot, option: WeeklyOption) => `${slot.id}-${option.ingredientId}`;
export function weeklySuggestedMinutes(plan: WeeklyMeal, servings: number): number | undefined {
  return plan.suggestedMaxTime === undefined ? undefined : plan.suggestedMaxTime + (plan.extraServingMinutes ?? 0) * (servings - 1);
}

/** No bundled fallback: callers must supply the current user's plan. */
export function resolveWeeklyMeal(day: WeekDay, meal: WeekMeal, draft: WeeklyMealDraft, weeklyPlan?: WeeklyPlan): {
  items: { ingredientId: string; grams: number }[]; errors: string[];
} {
  const plan = weeklyPlan?.[day][meal];
  const items: { ingredientId: string; grams: number }[] = [];
  const errors: string[] = [];
  if (!plan) return { items, errors: ["Importa il tuo piano personale prima di scegliere un pasto settimanale."] };
  if (plan.freeChoice) return { items, errors: ["Questo pasto e a piacere: scegli e quantifica gli alimenti nel compositore manuale."] };
  for (const slot of plan.slots) {
    const option = selectedWeeklyOption(slot, draft);
    if (!option) {
      errors.push(`${slot.label}: scegli una delle alternative, senza sommarle.`);
      continue;
    }
    const ingredient = getIngredient(option.ingredientId);
    if (!ingredient) {
      errors.push(`${slot.label}: questa voce non e ancora disponibile nel catalogo.`);
      continue;
    }
    const raw = option.grams === null ? draft.grams[weeklyQuantityKey(slot, option)] : String(option.grams);
    const grams = raw?.trim() ? Number(raw.replace(",", ".")) : NaN;
    if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) {
      errors.push(`${slot.label}: indica i grammi per porzione, maggiori di zero e fino a 5000.`);
      continue;
    }
    if (items.some((item) => item.ingredientId === option.ingredientId)) {
      errors.push(`${slot.label}: alimento gia presente in un'altra voce. Scegli un'alternativa diversa o correggi il piano indicando una quantita complessiva.`);
      continue;
    }
    items.push({ ingredientId: option.ingredientId, grams });
  }
  if (!draft.confirmed) errors.push("Conferma che le voci del catalogo corrispondano ai prodotti, alle varianti e agli stati di peso della tua dieta.");
  return { items, errors };
}

export function applyWeeklyMeal(state: WeeklyDietState, input: RecipeInput): {
  input?: RecipeInput; errors: string[];
} {
  const key = weeklyMealKey(state.day, state.meal);
  const resolved = resolveWeeklyMeal(state.day, state.meal, state.drafts[key] ?? emptyWeeklyDraft(), state.plan);
  if (resolved.errors.length) return { errors: resolved.errors };
  const conflicts = resolved.items.flatMap((item) => {
    const food = getIngredient(item.ingredientId)!;
    const reason = ingredientRestriction(food, input.preferences);
    return reason ? [`${food.name}: ${reason} Non rimuoviamo automaticamente le tue restrizioni.`] : [];
  });
  if (conflicts.length) return { errors: conflicts };
  if (!Number.isInteger(input.preferences.servings) || input.preferences.servings < 1 || input.preferences.servings > 8) return { errors: ["Indica da 1 a 8 porzioni prima di confermare il pasto."] };
  return {
    input: {
      ...input,
      pantry: createMealBase(resolved.items, input.preferences.servings),
      preferences: { ...input.preferences, meal: state.meal, taste: state.plan![state.day][state.meal].taste },
    },
    errors: [],
  };
}

export function weeklyMealIsApplied(state: WeeklyDietState, input: RecipeInput): boolean {
  const key = weeklyMealKey(state.day, state.meal);
  if (state.appliedKey !== key || input.preferences.meal !== state.meal) return false;
  const resolved = resolveWeeklyMeal(state.day, state.meal, state.drafts[key] ?? emptyWeeklyDraft(), state.plan);
  if (resolved.errors.length) return false;
  const fixed: PantryItem[] = input.pantry.filter((item) => item.mode === "fixed");
  return fixed.length === resolved.items.length && resolved.items.every((item) =>
    fixed.some((entry) => entry.ingredientId === item.ingredientId && entry.dietGrams === item.grams &&
      entry.availableGrams >= item.grams * input.preferences.servings));
}
