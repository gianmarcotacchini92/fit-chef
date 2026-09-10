import type { Ingredient, PantryItem, Recipe } from "./types";

export function normalizeFoodName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export type ParsedMealItem = {
  ingredientId: string;
  inputName: string;
  grams: number | null;
  notice?: string;
};

const GRAMS_UNIT = "(?:grammi|grammo|gr\\.?|g\\.?)";
const QUANTITY_FIRST = new RegExp(`^([+-]?\\d+(?:[.,]\\d+)?)\\s*(?:${GRAMS_UNIT}\\s*|\\s+)(.+)$`, "i");
const QUANTITY_LAST = new RegExp(`^(.+?)\\s*:?\\s+([+-]?\\d+(?:[.,]\\d+)?)\\s*(?:${GRAMS_UNIT})?$`, "i");

export function parseMealText(
  text: string,
  catalog: Ingredient[],
): { items: ParsedMealItem[]; errors: string[] } {
  const items: ParsedMealItem[] = [];
  const errors: string[] = [];
  const lines = text.split(/[\n;+]|,(?!\d)|\s+e\s+(?=\d)/i)
    .map((line) => line.trim().replace(/^[-*\u2022]\s+/, "")).filter(Boolean);
  if (lines.length === 0) return { items, errors: ["Inserisci almeno un alimento del pasto."] };
  for (const line of lines) {
    const first = line.match(QUANTITY_FIRST);
    const last = first ? null : line.match(QUANTITY_LAST);
    const quantity = first?.[1] ?? last?.[2];
    const inputName = (first?.[2] ?? last?.[1] ?? line).trim().replace(/:$/, "").trim();
    const grams = quantity === undefined ? null : Number(quantity.replace(",", "."));
    const name = normalizeFoodName(inputName);
    const matches = catalog.filter((food) =>
      [food.name, ...food.aliases].some((alias) => normalizeFoodName(alias) === name));
    if (matches.length !== 1) {
      if (/^carne\s+(rossa|bianca)$/.test(name)) {
        errors.push(`"${inputName}": specifica tipo e taglio dal catalogo, per esempio "macinato magro di manzo", "petto di pollo" o "petto di tacchino". Non associamo automaticamente tutte le carni allo stesso alimento.`);
        continue;
      }
      errors.push(/^(verdura|verdure)(?:\s+liber[ae])?$/.test(name)
        ? `"${inputName}": indica quale verdura, per esempio pomodori o zucchine. I grammi mancanti potrai completarli dopo.`
        : `"${line}": alimento non riconosciuto in modo univoco. Scegli il nome dal catalogo; puoi scrivere i grammi come "90 gr pasta" o "pasta 90 g".`);
      continue;
    }
    if (grams !== null && (!Number.isFinite(grams) || grams <= 0 || grams > 5000)) {
      errors.push(`"${line}": la quantita deve essere maggiore di zero e non superiore a 5000 g per porzione.`);
      continue;
    }
    if (items.some((item) => item.ingredientId === matches[0].id)) {
      errors.push(`"${line}": alimento ripetuto. Indica una sola quantita complessiva.`);
      continue;
    }
    const notice = matches[0].id === "cream-cheese"
      ? `${inputName}: useremo la voce generica "Formaggio spalmabile classico". Non sono valori verificati del tuo Philadelphia e non valgono per tutte le varianti, ad esempio light o vegetale. Conferma solo se il prodotto corrisponde e confronta l'etichetta.`
      : undefined;
    items.push({ ingredientId: matches[0].id, inputName, grams, ...(notice ? { notice } : {}) });
  }
  return { items, errors };
}

export function parseDiet(
  text: string,
  catalog: Ingredient[],
): { items: { ingredientId: string; grams: number }[]; errors: string[] } {
  const parsed = parseMealText(text, catalog);
  const items: { ingredientId: string; grams: number }[] = [];
  const errors = [...parsed.errors];
  for (const item of parsed.items) {
    if (item.grams === null) errors.push(`"${item.inputName}": indica anche la quantita in grammi, per esempio "150 gr ${item.inputName}".`);
    else items.push({ ingredientId: item.ingredientId, grams: item.grams });
  }
  return { items, errors };
}

export function applyDietItems(
  pantry: PantryItem[],
  items: { ingredientId: string; grams: number }[],
  servings: number,
): PantryItem[] {
  const result = pantry.map((item) => ({ ...item }));
  for (const item of items) {
    const index = result.findIndex((entry) => entry.ingredientId === item.ingredientId);
    const entry: PantryItem = {
      ingredientId: item.ingredientId,
      availableGrams: Math.max(index >= 0 ? result[index].availableGrams : 0, item.grams * servings),
      mode: "fixed",
      dietGrams: item.grams,
    };
    if (index >= 0) result[index] = entry;
    else result.push(entry);
  }
  return result;
}

export function retainRecipes(recipes: Recipe[], favoriteIds: string[]): Recipe[] {
  const favorites = new Set(favoriteIds);
  const keptFavorites = recipes.filter((recipe) => favorites.has(recipe.id));
  const others = recipes.filter((recipe) => !favorites.has(recipe.id)).slice(0, 100 - keptFavorites.length);
  const retained = new Set([...keptFavorites, ...others].map((recipe) => recipe.id));
  return recipes.filter((recipe) => retained.has(recipe.id));
}

export function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: decimals }).format(value);
}
