import { INGREDIENTS } from "./catalog";
import type { FoodSnapshot } from "./nutrition-diary";

/**
 * Conservative editorial estimates for pizzeria portions: NOT declared product data.
 * Actual dough, toppings, oil and piece size can vary substantially.
 */
// Crostino model: 70 g of the existing editorial white-pizza estimate,
// 20 g generic catalog mozzarella and 10 g generic catalog cooked ham per 100 g.
// These proportions and the 100 g piece are assumptions, not measured recipe data.
const CROSTINO_VALUES = [
  290 * .7 + 250 * .2 + 145 * .1,
  8 * .7 + 18 * .2 + 20 * .1,
  49 * .7 + 1 * .2 + 1.5 * .1,
  8 * .7 + 19 * .2 + 6.5 * .1,
  2 * .7,
] as const;
const PIZZERIA = [
  { key: "pizza-crostino", pattern: /\bpizza\s+(?:al\s+)?crostino\b/i, name: "Pizza crostino (mozzarella e prosciutto cotto)", values: CROSTINO_VALUES, pieceGrams: 100 },
  { key: "pizza-margherita", pattern: /(?:pizza\s+)?margherita/i, name: "Pizza margherita", values: [260, 10, 32, 10, 2], pieceGrams: 95 },
  { key: "pizza-patate", pattern: /(?:pizza\s+(?:con\s+)?patate|pizza\s+alle\s+patate|(?:pezzi?\s+)?di\s+patate)/i, name: "Pizza con patate", values: [250, 7, 36, 9, 2], pieceGrams: 100 },
  { key: "pizza-diavola", pattern: /(?:pizza\s+)?diavola/i, name: "Pizza diavola", values: [295, 12, 31, 13, 2], pieceGrams: 95 },
  { key: "pizza-rossa", pattern: /pizza\s+rossa/i, name: "Pizza rossa", values: [255, 6, 43, 7, 2], pieceGrams: 85 },
  { key: "pizza-bianca", pattern: /pizza\s+bianca/i, name: "Pizza bianca", values: [290, 8, 49, 8, 2], pieceGrams: 85 },
  { key: "suppli", pattern: /suppl[iì]/i, name: "Supplì", values: [245, 7, 31, 10, 2], pieceGrams: 90 },
  { key: "crocchetta", pattern: /crocchett[ae]/i, name: "Crocchetta di patate", values: [235, 4, 30, 11, 3], pieceGrams: 50 },
] as const;

const HOME_DISHES = [
  { key: "polpette", pattern: /polpett[ae]/i, name: "Polpette in bianco (stima)", values: [210, 16, 8, 13, 1], pieceGrams: 45, unit: "polpetta" },
  { key: "arrosto-maiale", pattern: /arrosto di maiale|maiale arrosto|lonza arrosto/i, name: "Arrosto di maiale (stima)", values: [195, 27, 1, 9, 0], pieceGrams: 65, unit: "fetta" },
  { key: "arrosto-vitello", pattern: /arrosto di vitello|vitello arrosto/i, name: "Arrosto di vitello (stima)", values: [175, 27, 1, 7, 0], pieceGrams: 65, unit: "fetta" },
  { key: "polpettone", pattern: /polpettone/i, name: "Polpettone (stima)", values: [215, 17, 7, 13, 1], pieceGrams: 85, unit: "fetta" },
  { key: "lasagna", pattern: /lasagn[ae]/i, name: "Lasagna al forno (stima)", values: [170, 9, 16, 8, 1], pieceGrams: 180, unit: "porzione" },
] as const;
const WORD_NUMBERS: Record<string, number> = {
  un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6,
  sette: 7, otto: 8, nove: 9, dieci: 10,
};
const NORMALIZE = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const foodFromPizza = (item: typeof PIZZERIA[number]): FoodSnapshot => ({
  id: `estimate-${item.key}`,
  name: item.name,
  state: "porzione di pizzeria: peso indicativo da verificare",
  source: "Stima editoriale indicativa per 100 g: NON dati del locale e NON un'etichetta nutrizionale. Ingredienti, condimenti, fritti e dimensioni delle porzioni variano. Modifica i grammi prima di confermare." +
    (item.key === "pizza-crostino" ? " Modello ipotetico: 70% pizza bianca (stima editoriale), 20% mozzarella e 10% prosciutto cotto (valori generici del catalogo). Pezzo ipotizzato da 100 g, non misurato. Altri ingredienti e variazioni in cottura non inclusi." : ""),
  per100g: {
    kcal: item.values[0], protein: item.values[1], carbs: item.values[2],
    fat: item.values[3], fiber: item.values[4],
  },
});

function homeDishFood(item: typeof HOME_DISHES[number]): FoodSnapshot {
  return {
    id: "estimate-" + item.key,
    name: item.name,
    state: "piatto cotto: ricetta e quantità di olio sconosciute",
    source: "Stima editoriale generica, non dati del piatto consumato. Ingredienti e preparazione possono cambiare molto calorie e macro. Correggi il peso; per precisione crea la tua ricetta.",
    per100g: { kcal: item.values[0], protein: item.values[1], carbs: item.values[2], fat: item.values[3], fiber: item.values[4] },
  };
}

export type SmartMealItem = {
  food: FoodSnapshot;
  grams: number;
  estimated: boolean;
  description: string;
};
export type SmartMealPreview = { items: SmartMealItem[]; warnings: string[] };

function quantity(prefix: string): number | null {
  const text = NORMALIZE(prefix);
  const m = /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(?:pezzi?|tranci?|fette?|suppli|crocchette?)?\b/.exec(text);
  if (m) return Number(m[1].replace(",", "."));
  const words = text.split(/\s+/);
  for (let i = words.length - 1; i >= 0 && i >= words.length - 3; i--) {
    if (WORD_NUMBERS[words[i]] !== undefined) return WORD_NUMBERS[words[i]];
  }
  return null;
}

function catalogMatch(part: string, personalFoods: readonly FoodSnapshot[]): FoodSnapshot | null {
  const normalized = NORMALIZE(part);
  const catalogText = normalized.replace(/\b(?:di|del|della|con|al|alla|alla piastra)\b/g, " ").trim();
  const personal = personalFoods
    .filter((item) => NORMALIZE(item.name).length >= 3 && normalized.includes(NORMALIZE(item.name)))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (personal) return personal;
  const candidates = INGREDIENTS.flatMap((item) => [item.name, ...item.aliases]
    .filter((alias) => NORMALIZE(alias).length >= 3 && catalogText.includes(NORMALIZE(alias)))
    .map((alias) => ({ item, length: NORMALIZE(alias).length })));
  candidates.sort((a, b) => b.length - a.length);
  const match = candidates[0]?.item;
  return match ? { id: match.id, name: match.name, state: match.state, source: match.source, per100g: match.nutrients } : null;
}

/** User-provided natural-language meal text, entirely offline and no AI provider. */
export function parseSmartMeal(input: string, personalFoods: readonly FoodSnapshot[] = []): SmartMealPreview {
  const items: SmartMealItem[] = [], warnings: string[] = [];
  if (!input.trim()) return { items, warnings: ["Descrivi quello che hai mangiato."] };
  if (input.length > 1500) return { items, warnings: ["Descrizione troppo lunga (massimo 1500 caratteri)."] };
  const chunks = splitMealText(input).slice(0, 30);
  for (const original of chunks) {
    const part = original.replace(/^(?:stasera|oggi|a pranzo|a cena|a colazione|ho mangiato|mangio|ho preso|e poi)\s+/gi, "").trim();
    const personal = personalFoodMatches(part, personalFoods);
    const weight = /(?:^|\s)(-?\d+(?:[.,]\d+)?)\s*(?:g|gr|grammi)\b/i.exec(part);
    if (personal.length > 1) { warnings.push(`«${original}»: più alimenti personali con questo nome; scegli una voce distinta.`); continue; }
    if (personal.length === 1 && weight) {
      const grams = Number(weight[1].replace(",", "."));
      if (grams <= 0 || grams > 5000) { warnings.push(`«${original}»: quantità non valida.`); continue; }
      items.push({ food: personal[0], grams, estimated: personal[0].id.startsWith("personal-rustic-"), description: "Peso dichiarato; alimento personale" });
      continue;
    }
    const piece = PIZZERIA.find((candidate) => candidate.pattern.test(part));
    const prefix = piece ? part.slice(0, part.search(piece.pattern)) : "";
    const explicitGrams = /(?:^|\s)(-?\d+(?:[.,]\d+)?)\s*(?:g|gr|grammi)\b/i.exec(part);
    if (piece) {
      const count = quantity(prefix) ?? (part.includes("una ") || part.includes("un ") ? 1 : null);
      if (!explicitGrams && (count === null || !Number.isInteger(count) || count < 1 || count > 30)) {
        warnings.push(`«${original}»: indica quanti pezzi hai mangiato o il peso in grammi.`);
        continue;
      }
      const grams = explicitGrams ? Number(explicitGrams[1].replace(",", ".")) : count! * piece.pieceGrams;
      if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) { warnings.push(`«${original}»: quantità non valida.`); continue; }
      items.push({ food: foodFromPizza(piece), grams, estimated: !explicitGrams,
        description: explicitGrams ? "Peso dichiarato; nutrienti stimati" : `${count} pezzi × ~${piece.pieceGrams} g; verifica il peso` });
      continue;
    }
    const dish = HOME_DISHES.find((candidate) => candidate.pattern.test(part));
    if (dish) {
      const count = quantity(part.slice(0, part.search(dish.pattern)));
      if (!explicitGrams && (count === null || !Number.isInteger(count) || count < 1 || count > 30)) {
        warnings.push(`«${original}»: indica quanti pezzi/fette hai mangiato o i grammi.`);
        continue;
      }
      const grams = explicitGrams ? Number(explicitGrams[1].replace(",", ".")) : count! * dish.pieceGrams;
      if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) {
        warnings.push(`«${original}»: quantità non valida.`);
        continue;
      }
      items.push({
        food: homeDishFood(dish), grams, estimated: true,
        description: explicitGrams ? "Peso dichiarato; ingredienti e macro stimati" : `${count} × ~${dish.pieceGrams} g per ${dish.unit}; controlla la dimensione`,
      });
      continue;
    }
    if (!explicitGrams) {
      warnings.push(`«${original}»: alimento o peso non riconosciuto. Indica grammi o usa un gusto di pizza/fritto supportato.`);
      continue;
    }
    const food = catalogMatch(part, personalFoods);
    if (!food) { warnings.push(`«${original}»: alimento non trovato nel catalogo o nei tuoi alimenti.`); continue; }
    const grams = Number(explicitGrams[1].replace(",", "."));
    if (!Number.isFinite(grams) || grams <= 0 || grams > 5000) { warnings.push(`«${original}»: grammi non validi.`); continue; }
    items.push({ food, grams, estimated: false, description: "Quantità dichiarata; verifica crudo/cotto e prodotto" });
  }
  if (chunks.length >= 30) warnings.push("Troppi alimenti nella descrizione: dividi il pasto.");
  if (!items.length && !warnings.length) warnings.push("Nessun alimento riconosciuto.");
  return { items, warnings };
}

/** Preserve decimal commas and quantity-only continuations of a rustic dish. */
export function splitMealText(input: string): string[] {
  const chunks = input.replace(/(\d),(?=\d)/g, "$1.")
    .replace(/\s+e\s+(?=(?:\d|un\b|uno\b|una\b|due\b|tre\b|quattro\b|cinque\b|sei\b|sette\b|otto\b|nove\b|dieci\b))/gi, ";")
    .split(/[,;\n+]/).map(x => x.trim()).filter(Boolean);
  const result: string[] = [];
  for (const chunk of chunks) {
    if (result.length && /torta\s+(rustica|salata)|quiche/i.test(result[result.length - 1]) &&
      /^(?:\d+(?:\.\d+)?|un[ao]?|due|tre|quattro)\s*(?:fett[ae](?:\s+(?:medie|piccole|grandi))?|g|gr|grammi)(?:\s+(?:totali|in tutto))?$/i.test(chunk)) result[result.length - 1] += " " + chunk;
    else result.push(chunk);
  }
  return result;
}

export function personalFoodMatches(input: string, foods: readonly FoodSnapshot[]): FoodSnapshot[] {
  const normalized = NORMALIZE(input);
  const matches = foods.filter(food => normalized.includes(NORMALIZE(food.name)));
  const length = Math.max(0, ...matches.map(food => food.name.length));
  return matches.filter(food => food.name.length === length);
}
