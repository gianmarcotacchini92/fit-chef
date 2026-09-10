import highsLoader from "highs";
import { getIngredient } from "./catalog";
import type { GenerateRequest, Nutrients, PantryItem } from "./types";
import type { Slot, Template } from "./templates";

type Solver = Awaited<ReturnType<typeof highsLoader>>;
let solverPromise: Promise<Solver> | undefined;

export const MACROS = ["kcal", "protein", "carbs", "fat"] as const;
export function tolerance(key: typeof MACROS[number], target: number): number {
  return Math.max({ kcal: 25, protein: 3, carbs: 5, fat: 2 }[key], target * (key === "kcal" ? 0.05 : 0.1));
}

export type PlannedItem = { ingredientId: string; grams: number; role: string };
export const COSMETIC_ROLES = new Set(["olio", "acidità", "sale", "spezie", "aroma", "dolcificante", "guarnizione", "proteine in polvere", "salsa", "bevanda"]);
type Variable = {
  pantry: PantryItem;
  slot: Slot;
  step: number;
  x: string;
  y: string;
};

function increment(id: string): number {
  if (id === "salt" || id === "cinnamon") return 0.1;
  if (id === "paprika" || id === "cocoa") return 0.5;
  if (id === "olive-oil" || id === "lemon" || id === "honey") return 1;
  return 5;
}

function expression(terms: Array<[number, string]>): string {
  const nonzero = terms.filter(([coefficient]) => Math.abs(coefficient) > 1e-12);
  if (!nonzero.length) return "0";
  return nonzero.map(([coefficient, variable], index) =>
    `${coefficient < 0 ? "- " : index ? "+ " : ""}${Math.abs(Number(coefficient.toFixed(10)))} ${variable}`,
  ).join(" ");
}

export async function optimizeTemplate(
  template: Template,
  pantry: PantryItem[],
  request: GenerateRequest,
  forbiddenSelections: string[][] = [],
): Promise<PlannedItem[] | null> {
  const variables: Variable[] = [];
  for (const item of pantry) {
    const slot = template.slots.find((entry) => entry.ids.includes(item.ingredientId));
    if (!slot) {
      if (item.mode === "fixed") return null;
      continue;
    }
    const available = item.availableGrams / request.preferences.servings;
    if (available < slot.min - 1e-8 && item.mode !== "fixed") continue;
    const index = variables.length;
    variables.push({
      pantry: item, slot, step: item.mode === "fixed" ? 1 : increment(item.ingredientId),
      x: `x${index}`, y: `y${index}`,
    });
  }
  if (!variables.length || template.slots.some((slot) =>
    slot.required && !variables.some((entry) => entry.slot === slot))) return null;

  const objective: Array<[number, string]> = [];
  const constraints: string[] = [];
  const bounds: string[] = [];
  const integers: string[] = [];
  const binaries: string[] = [];
  const add = (terms: Array<[number, string]>, comparator: string, rhs: number) => {
    constraints.push(` c${constraints.length}: ${expression(terms)} ${comparator} ${Number(rhs.toFixed(9))}`);
  };
  const roleTerms = (role: string, multiplier = 1): Array<[number, string]> =>
    variables.filter((entry) => entry.slot.role === role).map((entry) => [entry.step * multiplier, entry.x]);
  const nutrientTerms = (key: keyof Nutrients, multiplier = 1): Array<[number, string]> =>
    variables.map((entry) => [getIngredient(entry.pantry.ingredientId)!.nutrients[key] / 100 * entry.step * multiplier, entry.x]);

  variables.forEach((entry, index) => {
    const { pantry: item, slot, step, x, y } = entry;
    const upper = Math.min(slot.max, item.availableGrams / request.preferences.servings);
    if (upper < 0) throw new Error("Invalid optimizer upper bound.");
    add([[step, x], [-slot.min, y]], ">=", 0);
    add([[step, x], [-upper, y]], "<=", 0);
    bounds.push(` 0 <= ${x} <= ${upper / step}`);
    binaries.push(y);
    if (item.mode === "fixed") {
      add([[step, x]], "=", item.dietGrams!);
      add([[1, y]], "=", 1);
    } else {
      integers.push(x);
    }
    const plus = `idealPlus${index}`, minus = `idealMinus${index}`;
    add([[step, x], [-slot.ideal, y], [-1, plus], [1, minus]], "=", 0);
    // Culinary portions provide the prior when targets are unset, never a calorie deficit.
    const priorWeight = MACROS.every((key) => request.targets[key] === null) ? 0.8 : 0.025;
    objective.push([priorWeight / slot.ideal, plus], [priorWeight / slot.ideal, minus]);
    objective.push([item.mode === "preferred" ? -0.22 : slot.required ? 0 : 0.035, y]);
    // A deterministic small tie-break keeps equal optima stable without rounding a solution.
    objective.push([(index + 1) * 0.000001, x]);
  });

  for (const slot of template.slots) {
    const terms: Array<[number, string]> = variables.filter((entry) => entry.slot === slot).map((entry) => [1, entry.y]);
    if (!terms.length) continue;
    add(terms, ">=", slot.required ? 1 : 0);
    add(terms, "<=", slot.maxChoices);
  }
  for (const ratio of template.ratios) {
    const numerator = roleTerms(ratio.numerator);
    if (!numerator.length) continue;
    add([...numerator, ...roleTerms(ratio.denominator, -ratio.min)], ">=", 0);
    add([...numerator, ...roleTerms(ratio.denominator, -ratio.max)], "<=", 0);
  }
  if (template.id === "whey-drink") {
    const water = variables.find((entry) => entry.slot.role === "acqua");
    if (water) {
      const maximumPowder = template.slots.find((entry) => entry.role === "polvere")!.max;
      // If water is explicitly selected, honour its weight and require a drinkable dilution.
      // Otherwise the instructions declare the measured zero-nutrient process water.
      add([...roleTerms("acqua"), ...roleTerms("polvere", -4), [maximumPowder * -4, water.y]], ">=", -maximumPowder * 4);
    }
  }
  const fat = variables.find((entry) => entry.pantry.ingredientId === "olive-oil");
  if (fat) add([[fat.step, fat.x]], "<=", request.preferences.maxAddedFatGrams);
  const sauce = variables.filter((entry) => entry.slot.role === "salsa");
  if (sauce.length && variables.some((entry) => entry.slot.role === "acidità")) {
    // A little citrus brightens a dairy dressing; it must not overwhelm the dairy.
    add([
      ...roleTerms("acidità"), ...roleTerms("salsa", -0.35),
      ...sauce.map((entry): [number, string] => [15, entry.y]),
    ], "<=", 15);
  }

  for (const key of MACROS) {
    const target = request.targets[key];
    if (target === null) continue;
    const plus = `${key}Plus`, minus = `${key}Minus`;
    add([...nutrientTerms(key), [-1, plus], [1, minus]], "=", target);
    const weight = key === "kcal" ? 2 : key === "protein" ? 1.5 : 1;
    objective.push([weight / tolerance(key, target), plus], [weight / tolerance(key, target), minus]);
  }
  if (request.targets.strictCalories && request.targets.kcal !== null) {
    add(nutrientTerms("kcal"), "<=", request.targets.kcal);
  }
  if (request.targets.fiber !== null) {
    add([...nutrientTerms("fiber"), [1, "fiberShortfall"]], ">=", request.targets.fiber);
    objective.push([0.3, "fiberShortfall"]);
  }
  if (request.preferences.highProtein) {
    add([...nutrientTerms("protein", 4), ...nutrientTerms("kcal", -0.25)], ">=", 0);
  }
  const variant = request.variant;
  if (variant?.kind === "protein") {
    add(nutrientTerms("protein"), ">=", variant.baselineNutrition.protein * 1.1);
  }
  if (variant?.kind === "lighter") {
    add(nutrientTerms("kcal"), "<=", variant.baselineNutrition.kcal * 0.9);
  }
  for (const selection of forbiddenSelections) {
    const selected = new Set(selection);
    const structuralVariables = variables.filter((entry) => !COSMETIC_ROLES.has(entry.slot.role));
    const terms: Array<[number, string]> = structuralVariables.map((entry) =>
      [selected.has(entry.pantry.ingredientId) ? -1 : 1, entry.y]);
    const includedCount = structuralVariables.filter((entry) => selected.has(entry.pantry.ingredientId)).length;
    add(terms, ">=", 1 - includedCount);
  }
  const model = [
    "Minimize", ` obj: ${expression(objective)}`, "Subject To", ...constraints,
    "Bounds", ...bounds,
    ...(integers.length ? ["Generals", ` ${integers.join(" ")}`] : []),
    "Binaries", ` ${binaries.join(" ")}`, "End",
  ].join("\n");
  solverPromise ??= highsLoader();
  const solver = await solverPromise;
  const solution = solver.solve(model, {
    output_flag: false, threads: 1, parallel: "off", random_seed: 0,
    mip_rel_gap: 0, mip_abs_gap: 0, mip_max_nodes: 20000,
  });
  if (solution.Status === "Infeasible") return null;
  if (solution.Status !== "Optimal") {
    throw new Error(`HiGHS non ha completato l'ottimizzazione: ${solution.Status}`);
  }
  return variables.flatMap((entry) => {
    const value = solution.Columns[entry.x]?.Primal;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("HiGHS ha restituito una quantità non valida.");
    const perServing = entry.pantry.mode === "fixed"
      ? entry.pantry.dietGrams!
      : Math.round(value) * entry.step;
    if (perServing < 1e-8) return [];
    return [{
      ingredientId: entry.pantry.ingredientId,
      grams: entry.pantry.mode === "fixed"
        ? perServing * request.preferences.servings
        : Number((perServing * request.preferences.servings).toFixed(6)),
      role: entry.slot.role,
    }];
  });
}
