import { z } from "zod";
import { INGREDIENTS } from "./catalog";
import { catalogFood, type FoodSnapshot } from "./nutrition-diary";
import { isSupportedEditorialMeal, parseSmartMeal, splitMealText } from "./smart-meal";

export const normalizeMealName = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words: Record<string, number> = { un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, mezzo: .5, mezza: .5 };
export type MealQuantity = { grams: number | null; count: number | null; unit: string; label: string; invalid: boolean };

/** Only explicit mass is converted automatically; volume and counts need a confirmed weight. */
export function mealQuantity(text: string): MealQuantity {
  const mass = /(?:^|\s)(-?\d+(?:[.,]\d+)?)\s*(kg|chilogrammi|hg|etti|etto|g|gr|grammi)\b/i.exec(text);
  if (mass) {
    const n = Number(mass[1].replace(",", "."));
    const grams = n * (/^(kg|chilogrammi)$/i.test(mass[2]) ? 1000 : /^(hg|etti|etto)$/i.test(mass[2]) ? 100 : 1);
    return { grams, count: null, unit: "g", label: mass[0].trim(), invalid: !Number.isFinite(grams) || grams <= 0 || grams > 5000 };
  }
  const count = /(?:^|\s)(-?\d+(?:[.,]\d+)?|un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|mezzo|mezza)\s*(ml|cl|litri?|l|bicchier[ei]|tazz[ae]|cucchiai[oi]?|cucchiain[oi]|fett[ae]|pezz[oi]|porzion[ei]|piatt[oi]|vasett[oi])?\b/i.exec(text);
  const n = count ? words[count[1].toLowerCase()] ?? Number(count[1].replace(",", ".")) : null;
  return { grams: null, count: n, unit: count?.[2] ?? "pezzi", label: count?.[0].trim() ?? "", invalid: n !== null && (!Number.isFinite(n) || n <= 0 || n > 5000) };
}

export function mealQuery(text: string): string {
  const q = mealQuantity(text);
  return text.replace(/^(?:oggi\s+|stasera\s+|a (?:pranzo|cena|colazione)\s+|ho (?:mangiato|preso|bevuto)\s+|mangio\s+)+/i, "")
    .replace(q.label, "").replace(/^\s*(?:di|del|della)\s+/i, "").replace(/\s+/g, " ").trim().slice(0, 100);
}

function editDistanceOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (a.length <= b.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export function mealCandidates(query: string, saved: readonly FoodSnapshot[]): FoodSnapshot[] {
  const normalized = normalizeMealName(query);
  if (!normalized) return [];
  const tokens = normalized.split(" ").filter(t => !["di", "con", "al", "alla", "e", "del", "della"].includes(t));
  const foods = [...saved.map(food => ({ food, aliases: [food.name, ...(food.mealAliases ?? [])], personal: true })),
    ...INGREDIENTS.map(food => ({ food: catalogFood(food.id), aliases: [food.name, ...food.aliases], personal: false }))];
  return foods.map(entry => {
    const aliases = entry.aliases.map(normalizeMealName);
    const exact = aliases.includes(normalized);
    const score = exact ? (entry.personal ? 1000 : 900) : Math.max(0, ...aliases.map(alias => {
      const at = alias.split(" ");
      return tokens.reduce((n, token) => n + (at.includes(token) ? 20 : at.some(t => token.length >= 5 && editDistanceOne(token, t)) ? 10 : 0), 0);
    }));
    return { food: entry.food, score };
  }).filter(e => e.score > 0).sort((a, b) => b.score - a.score).slice(0, 6).map(e => e.food);
}

export type MealResolution = { original: string; query: string; quantity: MealQuantity; candidates: FoodSnapshot[]; food: FoodSnapshot | null; grams: number | null; note: string };

/** Strict personal alias reuse; never substitute a component for an entire unknown dish. */
export function resolveMealPhrase(original: string, saved: readonly FoodSnapshot[], suggestedQuery?: string): MealResolution {
  const quantity = mealQuantity(original);
  const query = suggestedQuery?.trim() || mealQuery(original);
  const candidates = mealCandidates(query, saved);
  const result: MealResolution = { original, query, quantity, candidates, food: null, grams: quantity.invalid ? null : quantity.grams, note: "Conferma alimento, stato crudo/cotto e quantità." };
  if (quantity.invalid) return { ...result, note: "Quantità non valida: correggi la frase." };
  const normalized = normalizeMealName(mealQuery(original));
  const exact = candidates.filter(food => {
    const ingredient = INGREDIENTS.find(i => i.id === food.id);
    return [food.name, ...(food.mealAliases ?? []), ...(ingredient?.aliases ?? [])].some(alias => normalizeMealName(alias) === normalized);
  });
  const personal = exact.filter(food => saved.some(f => f.id === food.id));
  const matches = personal.length ? personal : exact;
  if (matches.length === 1) return { ...result, food: matches[0] };
  // Keep existing explicit portion estimates for supported dishes. Compound/unknown
  // phrases otherwise remain unresolved instead of matching an ingredient substring.
  const localQuery = mealQuery(original);
  const canonical = quantity.grams !== null ? `${quantity.grams} g ${localQuery}`
    : quantity.count !== null && ["pezzi", "pezzo", "fetta", "fette", "porzione", "porzioni"].includes(quantity.unit) ? `${quantity.count} pezzi di ${localQuery}` : original;
  const legacy = parseSmartMeal(canonical, saved);
  if (isSupportedEditorialMeal(localQuery) && legacy.items.length === 1 && !legacy.warnings.length) {
    return { ...result, food: legacy.items[0].food, grams: legacy.items[0].grams, note: legacy.items[0].description };
  }
  return result;
}

/** Shared meal splitting preserves decimal commas and ingredient conjunctions. */
export function mealPhrases(input: string): string[] {
  return splitMealText(input);
}

// The model may only segment and name foods. Nutrition and weights are NOT model fields.
export const mealLanguageSchema = z.strictObject({ segments: z.array(z.strictObject({
  text: z.string().min(1).max(1500), kind: z.enum(["food", "context"]), query: z.string().max(100),
})).min(1).max(60) });
export type MealLanguage = z.infer<typeof mealLanguageSchema>;
export function validateMealLanguage(value: unknown, input: string): MealLanguage {
  const parsed = mealLanguageSchema.parse(value);
  if (parsed.segments.map(s => s.text).join("") !== input) throw new Error("Interpretazione incompleta: il testo originale non è stato conservato.");
  for (const segment of parsed.segments) {
    if (segment.kind === "food" && !segment.query.trim()) throw new Error("Nome alimento mancante.");
    if (segment.kind === "context" && normalizeMealName(segment.text).split(" ").some(t => t && !["ho", "mangiato", "bevuto", "preso", "oggi", "ieri", "stasera", "a", "pranzo", "cena", "colazione", "merenda", "e", "poi", "anche"].includes(t))) {
      throw new Error("La risposta ha escluso una parte del pasto: usa la revisione locale.");
    }
  }
  if (!parsed.segments.some(s => s.kind === "food")) throw new Error("Nessun alimento riconosciuto.");
  return parsed;
}

/** The ricotta pilot is offered only when every word fits its limited model. */
export function isPilotRusticPhrase(input: string): boolean {
  const allowed = new Set("ho mangiato preso oggi ieri stasera a pranzo cena colazione torta rustica salata quiche ricotta con ripieno di della del alla fette fetta porzione porzioni pezzo pezzi piccola piccole media medie grande grandi un uno una due tre quattro cinque sei sette otto nove dieci g gr grammi peso totale totali in tutto".split(" "));
  return normalizeMealName(input).split(" ").every(token => /^\d+$/.test(token) || allowed.has(token));
}
