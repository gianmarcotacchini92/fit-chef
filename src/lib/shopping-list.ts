import { emptyWeeklyDraft, resolveWeeklyMeal, WEEK_DAYS, WEEK_MEALS, weeklyMealKey } from "./weekly-diet";
import { catalogFood, type FoodSnapshot } from "./nutrition-diary";
import type { WeeklyDietState } from "./types";

export function weeklyShoppingList(state: WeeklyDietState, savedFoods: readonly FoodSnapshot[]) {
  const totals = new Map<string, { id: string; name: string; grams: number }>();
  const incomplete: { meal: string; reason: string }[] = [];
  if (!state.plan) return { items: [], incomplete };

  for (const day of WEEK_DAYS) {
    for (const meal of WEEK_MEALS) {
      if (state.plan[day.id][meal.id].freeChoice) continue;
      const draft = state.drafts[weeklyMealKey(day.id, meal.id)] ?? emptyWeeklyDraft();
      const result = resolveWeeklyMeal(day.id, meal.id, { ...draft, confirmed: true }, state.plan, savedFoods);
      for (const reason of result.errors) incomplete.push({ meal: `${day.label} · ${meal.label}`, reason });
      for (const item of result.items) {
        const food = item.food ?? catalogFood(item.ingredientId);
        const total = totals.get(food.id);
        if (total) total.grams += item.grams;
        else totals.set(food.id, { id: food.id, name: food.name, grams: item.grams });
      }
    }
  }
  return { items: [...totals.values()].sort((left, right) => left.name.localeCompare(right.name, "it")), incomplete };
}
