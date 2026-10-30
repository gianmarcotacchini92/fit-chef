import { INGREDIENTS } from "./catalog";
import type { FoodSnapshot } from "./nutrition-diary";

export type NaturalItem = {
  id: string; description: string; food: FoodSnapshot;
  grams: number; estimated: boolean; reason: string;
};
export type NaturalParse = { items: NaturalItem[]; unresolved: string[] };

const pizzaData: Record<string, { name: string; values: [number, number, number, number, number] }> = {
  margherita: { name: "Pizza in pala margherita", values: [250, 10, 31, 9, 2] },
  patate: { name: "Pizza in pala con patate", values: [245, 6, 37, 7.5, 2.5] },
  rossa: { name: "Pizza in pala rossa", values: [235, 6, 41, 5, 2] },
  bianca: { name: "Pizza in pala bianca", values: [285, 7, 44, 9, 2] },
  diavola: { name: "Pizza in pala diavola", values: [285, 12, 30, 12, 2] },
  funghi: { name: "Pizza in pala ai funghi", values: [250, 10, 30, 9, 2] },
};
const friedData: Record<string, { name: string; grams: number; values: [number, number, number, number, number] }> = {
  suppli: { name: "Supplì fritto", grams: 100, values: [245, 7, 30, 11, 2] },
  crocchetta: { name: "Crocchetta di patate fritta", grams: 60, values: [225, 4, 28, 11, 2] },
  fiore: { name: "Fiore di zucca fritto", grams: 70, values: [230, 7, 20, 13, 2] },
};
const amounts: Record<string, number> = {
  un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6,
  sette: 7, otto: 8, nove: 9, dieci: 10,
};
const ignored = /^(?:ho mangiato|ho preso|stasera|oggi|a cena|a pranzo|per cena|per pranzo|circa|anche|piu|più|e|di|della|del|dei|degli|delle|un po' di)\s*/;

function clean(text: string): string {
  return text.toLocaleLowerCase("it").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.!?]/g, " ").replace(/\s+/g, " ").trim();
}
function snapshot(id: string, name: string, values: [number, number, number, number, number]): FoodSnapshot {
  const [kcal, protein, carbs, fat, fiber] = values;
  return {
    id: `estimated-${id}`, name, state: "porzione generica pronta, stima",
    source: "Stima editoriale indicativa per pizza in pala/fritti. Ricette, taglie, condimenti e olio possono variare molto; non sono valori verificati di un locale.",
    per100g: { kcal, protein, carbs, fat, fiber },
  };
}
function catalogSnapshot(id: string): FoodSnapshot | undefined {
  const ingredient = INGREDIENTS.find((item) => item.id === id);
  return ingredient ? {
    id: ingredient.id, name: ingredient.name, state: ingredient.state, source: ingredient.source,
    per100g: ingredient.nutrients,
  } : undefined;
}
function matchFood(description: string, saved: readonly FoodSnapshot[]): FoodSnapshot | null {
  const normalized = clean(description);
  const items = [...saved.map((food) => ({ food, terms: [food.name] })),
    ...INGREDIENTS.map((ingredient) => ({ food: catalogSnapshot(ingredient.id)!, terms: [ingredient.name, ...ingredient.aliases] }))];
  const matches = items.flatMap((item) => item.terms.map((term) => ({ food: item.food, term: clean(term) }))
    .filter(({ term }) => term.length >= 3 && (normalized === term || normalized.includes(term))));
  matches.sort((a, b) => b.term.length - a.term.length);
  return matches[0]?.food ?? null;
}

/**
 * Offline and deterministic. Only known quantities are converted automatically.
 * Piece weights for pala pizza and fried foods are explicitly labelled as estimates.
 * Unsupported/missing quantities are returned for clarification, not logged as zero.
 */
export function parseNaturalMeal(text: string, savedFoods: readonly FoodSnapshot[] = []): NaturalParse {
  if (text.length > 2000) return { items: [], unresolved: ["Descrizione troppo lunga (massimo 2000 caratteri)."] };
  const normalized = clean(text)
    .replace(/\s+e\s+(?=(?:\d+|un |una |uno |due |tre |quattro |cinque |sei |sette |otto |nove |dieci )(?:(?:pezzi?|fette?|tranci?)\s+(?:di\s+)?)?)/g, ", ");
  const pieces = normalized.split(/[,;\n]+/).map((part) => part.replace(ignored, "").trim()).filter(Boolean);
  const items: NaturalItem[] = [], unresolved: string[] = [];
  for (let index = 0; index < pieces.length; index++) {
    const original = pieces[index];
    let remainder = original;
    const qty = /^(\d+(?:[.,]\d+)?|un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s*(g|gr|grammi|grammo|kg|pezzi?|fette?|tranci?)?\s*(?:di\s+)?/.exec(remainder);
    let quantity = qty ? (amounts[qty[1]] ?? Number(qty[1].replace(",", "."))) : null;
    let unit = qty?.[2] ?? "";
    if (qty) remainder = remainder.slice(qty[0].length).trim();
    // Support "pizza margherita 120 g" and "pizza 2 pezzi" as well as prefix quantities.
    const suffix = /\s+(\d+(?:[.,]\d+)?)\s*(g|gr|grammi|kg|pezzi?|fette?|tranci?)$/.exec(remainder);
    if (!qty && suffix) {
      quantity = Number(suffix[1].replace(",", ".")); unit = suffix[2];
      remainder = remainder.slice(0, -suffix[0].length).trim();
    }
    if (!remainder) { unresolved.push(original); continue; }
    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
      unresolved.push(`${original}: quantità mancante; indica i grammi o il numero di pezzi.`);
      continue;
    }
    if (quantity > 5000) { unresolved.push(`${original}: quantità non valida.`); continue; }
    const isPieces = /^(pezzi?|fette?|tranci?)$/.test(unit) || (!unit && quantity <= 20);
    const grams = !isPieces ? quantity * (unit === "kg" ? 1000 : 1) : null;
    const keyword = Object.keys(pizzaData).find((name) => remainder.includes(name));
    const pizza = remainder.includes("pizza") || (keyword && /^(?:margherita|diavola|rossa|bianca)$/.test(remainder));
    const friedKey = remainder.includes("suppli") ? "suppli" : remainder.includes("crocchett") ? "crocchetta"
      : remainder.includes("fior") && remainder.includes("zucca") ? "fiore" : null;
    let food: FoodSnapshot | null = null;
    let estimated = false;
    let reason = "";
    let weight = grams;
    if (pizza) {
      if (!keyword) { unresolved.push(`${original}: specifica il gusto della pizza (es. margherita, patate, rossa, bianca, diavola, funghi).`); continue; }
      const profile = pizzaData[keyword];
      food = snapshot(`pizza-${keyword}`, profile.name, profile.values);
      if (isPieces) { weight = quantity * 90; estimated = true; reason = "90 g per pezzo di pala: valore ipotetico, modificabile."; }
      else { estimated = true; reason = "Valori nutrizionali generici di pizza in pala, non del locale."; }
    } else if (friedKey) {
      const profile = friedData[friedKey];
      food = snapshot(friedKey, profile.name, profile.values);
      if (isPieces) { weight = quantity * profile.grams; estimated = true; reason = `${profile.grams} g per pezzo: stima modificabile.`; }
      else { estimated = true; reason = "Valori nutrizionali generici di fritto, non del locale."; }
    } else {
      food = matchFood(remainder, savedFoods);
      if (!food) { unresolved.push(`${original}: alimento non riconosciuto. Usa catalogo o alimento personale.`); continue; }
      if (isPieces) { unresolved.push(`${original}: per questo alimento serve un peso in grammi.`); continue; }
      if (food.state.includes("secco") || food.state.includes("crudo")) reason = "Controlla lo stato crudo/secco indicato nel catalogo.";
    }
    if (!food || weight === null || weight <= 0 || weight > 5000) { unresolved.push(`${original}: peso non valido.`); continue; }
    items.push({ id: `line-${index}`, description: original, food, grams: Math.round(weight * 10) / 10, estimated, reason });
  }
  return { items, unresolved };
}
