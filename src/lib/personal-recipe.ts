import { z } from "zod";
import { foodSnapshotSchema, type FoodSnapshot } from "./nutrition-diary";
import type { Nutrients } from "./types";

export const personalRecipeSchema = z.strictObject({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  createdAt: z.iso.datetime(),
  servings: z.number().int().min(1).max(100),
  cookedWeightGrams: z.number().finite().positive().max(100000),
  items: z.array(z.strictObject({
    food: foodSnapshotSchema,
    grams: z.number().finite().positive().max(5000),
  })).min(1).max(60),
}).refine(recipe => new Set(recipe.items.map(x=>x.food.id)).size === recipe.items.length, "Ingredienti duplicati: uniscili in una sola voce.");

export type PersonalRecipe = z.infer<typeof personalRecipeSchema>;

export function recipeNutrition(recipe: PersonalRecipe): { total: Nutrients; perServing: Nutrients; per100g: Nutrients; servingGrams: number } {
  const r = personalRecipeSchema.parse(recipe);
  const total = r.items.reduce<Nutrients>((sum, item) => {
    const factor = item.grams / 100;
    for (const key of ["kcal", "protein", "carbs", "fat", "fiber"] as const) sum[key] += item.food.per100g[key] * factor;
    return sum;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  const divide = (n: number) => Object.fromEntries((["kcal","protein","carbs","fat","fiber"] as const).map(k=>[k,total[k]/n])) as Nutrients;
  return { total, perServing: divide(r.servings), per100g: divide(r.cookedWeightGrams / 100), servingGrams: r.cookedWeightGrams / r.servings };
}

/** A food snapshot with grams referring to the finished cooked recipe, not raw ingredients. */
export function recipeFood(recipe: PersonalRecipe): FoodSnapshot {
  const { per100g } = recipeNutrition(recipe);
  return foodSnapshotSchema.parse({
    id: `recipe-${recipe.id}`,
    name: recipe.name,
    state: "ricetta casalinga, peso finale cotto",
    source: "Ricetta inserita dall'utente: valori calcolati dagli ingredienti prima della cottura e divisi per il peso finale dichiarato. Le perdite nutrizionali in cottura non sono stimate; verifica gli ingredienti.",
    per100g,
  });
}
