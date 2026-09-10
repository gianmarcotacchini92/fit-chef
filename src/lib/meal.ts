import { getIngredient } from "./catalog";
import { TEMPLATES, type Template } from "./templates";
import type { Ingredient, Nutrients, PantryItem, Preferences, Recipe, RecipeInput, RecipeItem } from "./types";

export type MealExtra = {
  ingredientId: string;
  reason: string;
  grams: number;
  maxGrams: number;
};

export type ChefExtraProposal = {
  title: string;
  description: string;
  extras: MealExtra[];
  maximumKcal: number;
};

const SAVORY_EXTRAS: MealExtra[] = [
  { ingredientId: "breadcrumbs", reason: "Una crosta leggera per medaglioni e polpettine.", grams: 15, maxGrams: 25 },
  { ingredientId: "wheat-flour", reason: "Un velo di farina per dorare e legare il fondo di cottura.", grams: 10, maxGrams: 20 },
  { ingredientId: "olive-oil", reason: "Per una doratura controllata, senza friggere.", grams: 5, maxGrams: 10 },
  { ingredientId: "greek-yogurt", reason: "Una salsa fresca e cremosa da servire a parte.", grams: 40, maxGrams: 80 },
  { ingredientId: "lemon", reason: "Acidita e freschezza per il condimento.", grams: 15, maxGrams: 25 },
  { ingredientId: "paprika", reason: "Un tocco speziato, senza aggiungere una salsa.", grams: 1, maxGrams: 2 },
  { ingredientId: "salt", reason: "Una piccola quantita, sempre esplicita.", grams: .5, maxGrams: 1 },
];

const SWEET_EXTRAS: MealExtra[] = [
  { ingredientId: "cocoa", reason: "Per trasformare yogurt e frutta in una crema al cacao.", grams: 5, maxGrams: 10 },
  { ingredientId: "oats", reason: "Per una coppa a strati o una consistenza piu corposa.", grams: 15, maxGrams: 30 },
  { ingredientId: "peanut-butter", reason: "Un piccolo topping cremoso, con tutti i grassi conteggiati.", grams: 8, maxGrams: 15 },
  { ingredientId: "cinnamon", reason: "Un profumo da dessert, senza zucchero aggiunto.", grams: .5, maxGrams: 1 },
  { ingredientId: "greek-yogurt", reason: "Una crema fresca per accompagnare frutta e pancake.", grams: 40, maxGrams: 80 },
];

export function getMealExtraSuggestions(pantry: PantryItem[], taste: Preferences["taste"]): MealExtra[] {
  const baseIds = new Set(pantry.filter((item) => item.mode === "fixed").map((item) => item.ingredientId));
  if (!baseIds.size) return [];
  const sweet = taste === "sweet" || (
    !["lean-beef", "chicken", "turkey", "tuna", "tofu", "chickpeas", "lentils"].some((id) => baseIds.has(id))
    && ["banana", "strawberries", "berries", "apple"].some((id) => baseIds.has(id))
  );
  const source = sweet ? SWEET_EXTRAS : SAVORY_EXTRAS;
  const templates = compatibleMealTemplates(pantry, sweet, source);
  return source.filter((extra) => !baseIds.has(extra.ingredientId) && getIngredient(extra.ingredientId) !== undefined
    && templates.some((template) => extraFitsTemplate(template, extra, baseIds)));
}

function extraFitsTemplate(template: Template, extra: MealExtra, baseIds: Set<string>): boolean {
  return template.slots.some((slot) => slot.ids.includes(extra.ingredientId)
    && slot.ids.filter((id) => baseIds.has(id)).length < slot.maxChoices
    && extra.grams >= slot.min);
}

function compatibleMealTemplates(pantry: PantryItem[], sweet: boolean, extras: MealExtra[]): Template[] {
  const baseIds = new Set(pantry.filter((item) => item.mode === "fixed").map((item) => item.ingredientId));
  return TEMPLATES.filter((template) => template.taste === (sweet ? "sweet" : "savory")
    && [...baseIds].every((id) => template.slots.some((slot) => slot.ids.includes(id)))
    && template.slots.every((slot) => slot.ids.filter((id) => baseIds.has(id)).length <= slot.maxChoices)
    && template.slots.filter((slot) => slot.required).every((slot) =>
      slot.ids.some((id) => baseIds.has(id)) || extras.some((extra) => slot.ids.includes(extra.ingredientId) && extra.grams >= slot.min)));
}

export function getChefExtraProposal(input: RecipeInput): ChefExtraProposal | null {
  const base = input.pantry.filter((item) => item.mode === "fixed");
  if (!base.length || base.some((item) => {
    const food = getIngredient(item.ingredientId);
    return !food || ingredientRestriction(food, input.preferences);
  })) return null;
  const baseIds = new Set(base.map((item) => item.ingredientId));
  const poultry = ["chicken", "turkey"].some((id) => baseIds.has(id)) && baseIds.has("fennel") && baseIds.has("bread");
  const beef = baseIds.has("lean-beef") && baseIds.has("zucchini");
  const priorities = poultry ? ["greek-yogurt", "lemon", "paprika", "olive-oil"]
    : beef ? ["breadcrumbs", "paprika", "olive-oil", "greek-yogurt"]
    : ["cocoa", "cinnamon", "greek-yogurt", "olive-oil", "lemon", "paprika", "breadcrumbs", "wheat-flour", "peanut-butter", "oats"];
  const suggestions = getMealExtraSuggestions(input.pantry, input.preferences.taste)
    .filter((extra) => !ingredientRestriction(getIngredient(extra.ingredientId)!, input.preferences))
    .filter((extra) => priorities.includes(extra.ingredientId))
    .sort((left, right) => priorities.indexOf(left.ingredientId) - priorities.indexOf(right.ingredientId));
  const bundles = [false, true].flatMap((sweet) => compatibleMealTemplates(input.pantry, sweet, suggestions))
    .filter((template) => template.minutes + template.extraServingMinutes * (input.preferences.servings - 1) <= input.preferences.maxTime
      && template.equipment.every((tool) => input.preferences.equipment.includes(tool)))
    .map((template) => suggestions.filter((extra) => extraFitsTemplate(template, extra, baseIds)).slice(0, 4))
    .filter((extras) => extras.length);
  bundles.sort((left, right) => {
    const score = (extras: MealExtra[]) => extras.reduce((total, extra) => total + priorities.length - priorities.indexOf(extra.ingredientId), 0);
    return score(right) - score(left);
  });
  const extras = bundles[0];
  if (!extras) return null;
  return {
    title: poultry ? "Pane croccante, finocchi in slaw e una salsa fresca"
      : beef ? "Mini burger speziati, non la solita carne con verdure" : "Un piccolo intervento da chef, non ingredienti messi a lato",
    description: poultry
      ? "Il tuo pane puo diventare crumble croccante o tartine farcite. I finocchi cambiano consistenza e condimento: questi extra servono alla preparazione, non a decorare il nome."
      : beef ? "Una panatura sottile e le spezie cambiano la consistenza del macinato. Le zucchine entrano in una preparazione curata, senza cambiare le grammature del pasto."
        : "Queste aggiunte sono compatibili con preparazioni che usano i tuoi alimenti: servono per una crema, una doratura o un condimento preciso. La ricetta finale deve comunque rispettare tutti i vincoli.",
    extras,
    maximumKcal: extras.reduce((total, extra) => total + getIngredient(extra.ingredientId)!.nutrients.kcal * extra.grams / 100, 0),
  };
}

export function confirmChefExtras(input: RecipeInput, extras: MealExtra[]): RecipeInput {
  const suggestions = getMealExtraSuggestions(input.pantry, input.preferences.taste);
  let pantry = [...input.pantry];
  const ids = new Set<string>();
  for (const extra of extras) {
    const food = getIngredient(extra.ingredientId);
    const allowed = suggestions.find((candidate) => candidate.ingredientId === extra.ingredientId);
    if (!food || !allowed || ids.has(extra.ingredientId) || !Number.isFinite(extra.grams) || extra.grams <= 0 || extra.grams > allowed.maxGrams) {
      throw new Error("La proposta non e piu compatibile con il pasto. Rivedi le aggiunte prima di confermare.");
    }
    const restriction = ingredientRestriction(food, input.preferences);
    if (restriction) throw new Error(`${food.name}: ${restriction}`);
    ids.add(extra.ingredientId);
    if (!pantry.some((item) => item.ingredientId === extra.ingredientId && item.mode === "preferred")) {
      pantry = confirmMealExtra(pantry, extra.ingredientId, extra.grams, input.preferences.servings, true);
    }
  }
  return { ...input, pantry };
}

export function ingredientRestriction(ingredient: Ingredient, preferences: Preferences): string | null {
  if (preferences.excludedIngredientIds.includes(ingredient.id)) return "Alimento escluso dalle preferenze.";
  if (preferences.vegetarian && !ingredient.vegetarian) return "Non compatibile con la scelta vegetariana.";
  if (ingredient.allergens.some((allergen) => preferences.allergens.includes(allergen))) return "Contiene un allergene che hai escluso.";
  return null;
}

export function createMealBase(items: { ingredientId: string; grams: number }[], servings: number): PantryItem[] {
  if (!Number.isInteger(servings) || servings < 1 || servings > 8) throw new Error("Indica da 1 a 8 porzioni prima di confermare il pasto.");
  const ids = new Set<string>();
  return items.map((item) => {
    if (!getIngredient(item.ingredientId)) throw new Error(`Alimento non riconosciuto: ${item.ingredientId}.`);
    if (!Number.isFinite(item.grams) || item.grams <= 0 || item.grams > 5000) throw new Error("Indica una quantita valida, maggiore di zero, per ogni alimento.");
    if (ids.has(item.ingredientId)) throw new Error("Non ripetere lo stesso alimento: indica una quantita complessiva.");
    ids.add(item.ingredientId);
    return { ingredientId: item.ingredientId, dietGrams: item.grams, availableGrams: item.grams * servings, mode: "fixed" };
  });
}

export function confirmMealExtra(
  pantry: PantryItem[],
  ingredientId: string,
  gramsPerServing: number,
  servings: number,
  confirmed: boolean,
): PantryItem[] {
  if (pantry.some((item) => item.ingredientId === ingredientId && item.mode === "fixed")) throw new Error("Questo alimento fa gia parte del pasto: non puo essere aggiunto anche come extra.");
  const other = pantry.filter((item) => item.ingredientId !== ingredientId);
  if (!confirmed) return other;
  if (!getIngredient(ingredientId) || !Number.isFinite(gramsPerServing) || gramsPerServing <= 0 || gramsPerServing > 1000) throw new Error("Conferma una quantita valida per l'aggiunta.");
  if (!Number.isInteger(servings) || servings < 1 || servings > 8) throw new Error("Indica da 1 a 8 porzioni.");
  return [...other, {
    ingredientId,
    availableGrams: Number((gramsPerServing * servings).toFixed(6)),
    mode: "preferred",
    dietGrams: gramsPerServing,
  }];
}

export function mealGenerationInput(input: RecipeInput): RecipeInput {
  return {
    ...input,
    pantry: input.pantry.filter((item) => item.mode === "fixed" || item.mode === "preferred"),
  };
}

const NUTRIENTS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
const emptyNutrition = (): Nutrients => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

export function mealBaseNutrition(pantry: PantryItem[]): Nutrients | null {
  const base = pantry.filter((item) => item.mode === "fixed");
  if (!base.length) return null;
  const nutrients = emptyNutrition();
  for (const item of base) {
    const ingredient = getIngredient(item.ingredientId);
    if (!ingredient || !item.dietGrams || !Number.isFinite(item.dietGrams)) return null;
    for (const key of NUTRIENTS) nutrients[key] += ingredient.nutrients[key] * item.dietGrams / 100;
  }
  return nutrients;
}

function sumItems(items: RecipeItem[], servings: number): Nutrients {
  const result = emptyNutrition();
  for (const item of items) {
    for (const key of NUTRIENTS) result[key] += item.nutrients[key] / servings;
  }
  for (const key of NUTRIENTS) result[key] = Number(result[key].toFixed(6));
  return result;
}

export function recipeMealBreakdown(recipe: Recipe): {
  base: Nutrients;
  extras: Nutrients;
  baseItems: RecipeItem[];
  extraItems: RecipeItem[];
} | null {
  const fixedIds = new Set(recipe.input.pantry.filter((item) => item.mode === "fixed").map((item) => item.ingredientId));
  if (!fixedIds.size) return null;
  const baseItems = recipe.ingredients.filter((item) => fixedIds.has(item.ingredientId));
  const extraItems = recipe.ingredients.filter((item) => !fixedIds.has(item.ingredientId));
  return {
    base: sumItems(baseItems, recipe.servings),
    extras: sumItems(extraItems, recipe.servings),
    baseItems,
    extraItems,
  };
}
