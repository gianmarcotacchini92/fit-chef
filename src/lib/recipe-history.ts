import type { Recipe, RecipeFingerprint, RecipeInput } from "./types";

export const GENERATION_HISTORY_LIMIT = 30;

export function historyMatchesMeal(entry: RecipeFingerprint, input: RecipeInput): boolean {
  const fixed = input.pantry.filter((item) => item.mode === "fixed");
  if (fixed.length) return fixed.every((item) => entry.ingredientIds.includes(item.ingredientId));
  const available = new Set(input.pantry.filter((item) => item.availableGrams > 0).map((item) => item.ingredientId));
  return entry.ingredientIds.length > 0 && entry.ingredientIds.every((id) => available.has(id));
}

export function selectGenerationHistory(recipes: Recipe[], input: RecipeInput): RecipeFingerprint[] {
  const recent = recipes.map((recipe) => recipe.fingerprint).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const related = recent.filter((entry) => historyMatchesMeal(entry, input));
  const others = recent.filter((entry) => !historyMatchesMeal(entry, input));
  return [...related, ...others].slice(0, GENERATION_HISTORY_LIMIT);
}
