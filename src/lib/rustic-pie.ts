import type { FoodSnapshot } from "./nutrition-diary";

/**
 * Nutritive ingredient references, NOT a complete recipe.
 * USDA SR Legacy: ricotta whole milk NDB 01036 / FDC 170851;
 * puff pastry baked FDC 172738. Retrieved October 2026.
 * https://www.ars.usda.gov/ARSUserFiles/80400525/Data/SR/SR28/reports/sr28fg01.pdf
 * https://fdc.nal.usda.gov/food-details/172738/nutrients
 * FDC reports 45.7 g total carbohydrate incl. 1.5 g fiber. FIT Diario tracks available carbs: 44.2 g.
 */
export const RUSTIC_INGREDIENTS = {
  ricotta: { kcal: 174, protein: 11.26, carbs: 3.04, fat: 12.98, fiber: 0 },
  pastry: { kcal: 558, protein: 7.4, carbs: 44.2, fat: 38.5, fiber: 1.5 },
} as const;

export type RusticSize = "small" | "medium" | "large";
export type RusticBase = "unknown" | "puff" | "shortcrust" | "other";
export type RusticConfig = {
  slices: number;
  size: RusticSize;
  base: RusticBase;
  filling: "ricotta" | "unknown";
  // Actual measured mass takes precedence; no number is inferred from the user's phrase.
  knownGrams: number | null;
  // An explicit recipe-composition hypothesis, not a nutrient database field.
  pastrySharePercent: number;
};
export type RusticEstimate = {
  lowKcal: number; highKcal: number; gramsLow: number; gramsHigh: number;
  centralGrams: number; food: FoodSnapshot;
};

// Purely editorial sensitivity scenarios, NOT sourced population statistics
// or claims about what the user actually ate. Show these assumptions on screen.
export const RUSTIC_PORTION_SCENARIOS: Record<RusticSize, readonly [number, number]> = {
  small: [45, 95], medium: [70, 150], large: [120, 230],
};

export function detectRusticPie(input: string): { slices: number; size: RusticSize; filling: "ricotta" | "unknown"; phrase: string } | null {
  const match = /(?:torta\s+(?:rustica|salata)|quiche)/i.exec(input);
  if (!match) return null;
  const before = input.slice(Math.max(0, match.index - 70), match.index);
  const numeric = /(?:^|\s)(\d{1,2})\s*(?:fett[ea]|porzioni|pezzi)?\s*(?:piccol[ae]|medi[ae]|grand[ei])?\s*(?:di|della|dello|del)?\s*$/i.exec(before);
  const words = /(?:^|\s)(una?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+(?:fett[ea]|porzioni|pezzi)?\s*(?:piccol[ae]|medi[ae]|grand[ei])?\s*(?:di|della|dello|del)?\s*$/i.exec(before);
  const nums: Record<string, number> = { un: 1, una: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10 };
  const slices = numeric ? Number(numeric[1]) : words ? nums[words[1].toLowerCase()] ?? 0 : 0;
  const text = input.slice(match.index, Math.min(input.length, match.index + 100));
  const size: RusticSize = /(?:piccol[ae]|piccole)/i.test(input) ? "small" : /(?:grand[ei])/i.test(input) ? "large" : "medium";
  return { slices, size, filling: /ricotta/i.test(text) ? "ricotta" : "unknown", phrase: match[0] };
}

function blend(pastryShare: number) {
  const ratio = pastryShare / 100;
  const a = RUSTIC_INGREDIENTS.pastry, b = RUSTIC_INGREDIENTS.ricotta;
  return {
    kcal: a.kcal * ratio + b.kcal * (1 - ratio),
    protein: a.protein * ratio + b.protein * (1 - ratio),
    carbs: a.carbs * ratio + b.carbs * (1 - ratio),
    fat: a.fat * ratio + b.fat * (1 - ratio),
    fiber: a.fiber * ratio + b.fiber * (1 - ratio),
  };
}

export function estimateRusticPie(config: RusticConfig): RusticEstimate | null {
  if (config.base !== "puff" || config.filling !== "ricotta") return null;
  if (!Number.isInteger(config.slices) || config.slices < 1 || config.slices > 30) return null;
  if (!Number.isFinite(config.pastrySharePercent) || config.pastrySharePercent < 20 || config.pastrySharePercent > 70) return null;
  if (config.knownGrams !== null && (!Number.isFinite(config.knownGrams) || config.knownGrams <= 0 || config.knownGrams > 5000)) return null;
  const [minPiece, maxPiece] = RUSTIC_PORTION_SCENARIOS[config.size];
  const gramsLow = config.knownGrams ?? config.slices * minPiece;
  const gramsHigh = config.knownGrams ?? config.slices * maxPiece;
  const centralGrams = (gramsLow + gramsHigh) / 2;
  // Sensitivity calculation, not a statistical confidence interval.
  const minDensity = blend(25).kcal;
  const maxDensity = blend(55).kcal;
  const midpoint = blend(config.pastrySharePercent);
  const round = (x: number) => Math.round(x * 100) / 100;
  const food: FoodSnapshot = {
    id: "estimate-rustic-ricotta-puff",
    name: "Torta rustica ricotta e sfoglia (ipotesi)",
    state: "piatto composto: ripieno solo ricotta e sfoglia cotta ipotizzati",
    source: "MODELLO IPOTETICO, non misurazione della torta. Nutrienti ingredienti USDA SR Legacy (ricotta intera NDB 01036; sfoglia cotta FDC 172738). Composizione sfoglia ipotizzata " +
      config.pastrySharePercent + "% in peso; la fascia 25–55% e le masse per fetta sono SCENARI EDITORIALI non dati USDA. Altri ingredienti, olio e perdita d'acqua non inclusi. Verifica ricetta e pesi.",
    per100g: { kcal: round(midpoint.kcal), protein: round(midpoint.protein), carbs: round(midpoint.carbs),
      fat: round(midpoint.fat), fiber: round(midpoint.fiber) },
  };
  return { food, lowKcal: Math.round(minDensity * gramsLow / 100),
    highKcal: Math.round(maxDensity * gramsHigh / 100), gramsLow, gramsHigh, centralGrams };
}
