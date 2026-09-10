import { hashJson as hash } from "./portable-hash";
import { CATALOG_VERSION, getIngredient } from "./catalog";
import { COSMETIC_ROLES, MACROS, optimizeTemplate, tolerance } from "./engine-optimizer";
import { buildSteps } from "./engine-steps";
import { buildTitle } from "./engine-titles";
import { TEMPLATES, type Template } from "./templates";
import type {
  GenerateRequest, GenerationResponse, Ingredient, Nutrients, PantryItem,
  Recipe, RecipeFingerprint, RecipeInput,
} from "./types";

const NUTRIENTS = ["kcal", "protein", "carbs", "fat", "fiber"] as const;
const LABELS: Record<keyof Nutrients, string> = {
  kcal: "Calorie", protein: "Proteine", carbs: "Carboidrati", fat: "Grassi", fiber: "Fibre",
};
const ALLERGEN_IDS = new Set([
  "gluten", "milk", "eggs", "fish", "soy", "peanuts", "nuts", "sesame",
  "crustaceans", "molluscs", "celery", "mustard", "sulphites", "lupin",
]);
const EQUIPMENT_IDS = new Set(["pan", "stove", "oven", "air_fryer", "blender", "microwave", "refrigerator", "thermometer"]);
const THERMOMETER_INGREDIENT_IDS = new Set(["chicken", "turkey", "eggs", "egg-whites", "lean-beef", "white-fish"]);
const PRODUCT_DEPENDENT_IDS = new Set([
  "whey", "seafood-salad", "protein-bar", "ready-pancakes", "breakfast-cereal",
  "dark-chocolate", "jam", "cheese-slice", "cooked-ham", "plain-wrap", "bread",
  "mozzarella", "caciotta", "parmesan", "smoked-salmon", "peanut-butter",
]);
const NUTRITION_SOURCE = `Catalogo ${CATALOG_VERSION}: stime editoriali generiche per 100 g, nello stato indicato; carboidrati disponibili e fibre separate. Nessun valore è inventato da un nome generato e nessuna attribuzione a record USDA. Verifica l'etichetta del prodotto.`;
const EPSILON = 1e-6;

function round(value: number, places = 6): number {
  return Number(value.toFixed(places));
}

export function calculateNutrition(items: Array<{ ingredientId: string; grams: number }>): Nutrients {
  const result: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  for (const item of items) {
    const ingredient = getIngredient(item.ingredientId);
    if (!ingredient) throw new Error(`Ingrediente sconosciuto: ${item.ingredientId}`);
    if (!Number.isFinite(item.grams) || item.grams < 0) throw new Error(`Quantità non valida per ${item.ingredientId}.`);
    for (const key of NUTRIENTS) result[key] += ingredient.nutrients[key] * item.grams / 100;
  }
  for (const key of NUTRIENTS) result[key] = round(result[key]);
  return result;
}

function perServing(nutrition: Nutrients, servings: number): Nutrients {
  return Object.fromEntries(NUTRIENTS.map((key) => [key, round(nutrition[key] / servings)])) as Nutrients;
}

function failure(status: "needs_input" | "infeasible", message: string, details: string[]): GenerationResponse {
  return { status, message, details };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validate(request: GenerateRequest): GenerationResponse | null {
  if (!request || typeof request !== "object" || !request.targets || !request.preferences || !Array.isArray(request.pantry)) {
    return failure("needs_input", "Dati della richiesta incompleti.", ["Servono dispensa, obiettivi e preferenze."]);
  }
  const issues: string[] = [];
  const conflicts: string[] = [];
  const { preferences: p, targets } = request;
  for (const [key, values] of [
    ["goal", ["fat_loss", "muscle", "maintenance", "balanced"]],
    ["taste", ["savory", "sweet", "either"]],
    ["meal", ["breakfast", "lunch", "dinner", "snack", "dessert"]],
    ["difficulty", ["easy", "medium"]],
  ] as const) {
    if (!(values as readonly string[]).includes(p[key])) issues.push(`Preferenza ${key} sconosciuta.`);
  }
  if (!Number.isInteger(p.servings) || p.servings < 1 || p.servings > 8) issues.push("Indica da 1 a 8 porzioni.");
  if (!isFiniteNumber(p.maxTime) || p.maxTime < 1 || p.maxTime > 180) issues.push("Tempo disponibile non valido (1–180 minuti).");
  if (!isFiniteNumber(p.maxAddedFatGrams) || p.maxAddedFatGrams < 0 || p.maxAddedFatGrams > 100) issues.push("Limite di grassi aggiunti non valido (0–100 g per porzione).");
  for (const flag of ["vegetarian", "highProtein", "mealPrep"] as const) {
    if (typeof p[flag] !== "boolean") issues.push(`Preferenza ${flag} non valida.`);
  }
  for (const [key, allowed] of [
    ["equipment", EQUIPMENT_IDS], ["allergens", ALLERGEN_IDS],
  ] as const) {
    if (!Array.isArray(p[key]) || p[key].some((value) => !allowed.has(value))) issues.push(`Elenco ${key} non valido o con voci sconosciute.`);
  }
  if (!Array.isArray(p.excludedIngredientIds) || p.excludedIngredientIds.some((id) => !getIngredient(id))) {
    issues.push("L'elenco degli esclusi contiene ingredienti sconosciuti.");
  }
  if (typeof targets.strictCalories !== "boolean") issues.push("strictCalories deve essere booleano.");
  const maximums: Nutrients = { kcal: 3000, protein: 250, carbs: 500, fat: 150, fiber: 100 };
  for (const key of NUTRIENTS) {
    if (targets[key] !== null && (!isFiniteNumber(targets[key]) || targets[key]! < 0 || targets[key]! > maximums[key])) {
      issues.push(`${LABELS[key]}: usa null per non impostare un obiettivo o un numero finito tra 0 e ${maximums[key]}. Limite tecnico del generatore, non una prescrizione alimentare.`);
    }
  }
  const setTargets = NUTRIENTS.map((key) => targets[key]).filter((value) => value !== null);
  if (setTargets.length && setTargets.every((value) => value === 0)) issues.push("Obiettivi tutti a zero: non descrivono una porzione. Lascia i campi non desiderati vuoti (null).");
  if (targets.strictCalories && targets.kcal === null) issues.push("Il limite calorico rigido richiede un obiettivo calorie.");
  if (isFiniteNumber(targets.kcal) && targets.kcal > 0) {
    const macroEnergy = (targets.protein ?? 0) * 4 + (targets.carbs ?? 0) * 4 + (targets.fat ?? 0) * 9;
    if (macroEnergy > targets.kcal * 3 + 100) issues.push("Calorie e macronutrienti sono fortemente incoerenti tra loro; ricontrolla numeri e unità.");
  }
  if (request.pantry.length > 100) issues.push("La dispensa supera il limite tecnico di 100 righe.");
  const seen = new Set<string>();
  for (const item of request.pantry) {
    if (!item || typeof item !== "object") { issues.push("Riga dispensa non valida."); continue; }
    const ingredient = getIngredient(item.ingredientId);
    if (!ingredient) { issues.push(`Ingrediente sconosciuto: ${String(item.ingredientId)}. Seleziona un alimento dal catalogo.`); continue; }
    if (seen.has(item.ingredientId)) issues.push(`Ingrediente ripetuto: ${ingredient.name}; indica una sola disponibilità totale.`);
    seen.add(item.ingredientId);
    if (!isFiniteNumber(item.availableGrams) || item.availableGrams < 0 || item.availableGrams > 100000) issues.push(`Disponibilità non valida per ${ingredient.name}.`);
    if (!["available", "fixed", "preferred"].includes(item.mode)) issues.push(`Modalità sconosciuta per ${ingredient.name}.`);
    if (item.dietGrams !== undefined && (!isFiniteNumber(item.dietGrams) || item.dietGrams <= 0)) issues.push(`La quantità della dieta di ${ingredient.name} deve essere maggiore di zero.`);
    if (item.mode === "fixed") {
      if (!isFiniteNumber(item.dietGrams) || item.dietGrams <= 0) issues.push(`Indica dietGrams > 0 per ${ingredient.name}, per porzione.`);
      else if (item.dietGrams * p.servings > item.availableGrams + EPSILON) conflicts.push(`${ingredient.name}: servono ${round(item.dietGrams * p.servings)} g totali per rispettare la dieta, ma la dispensa ne contiene ${item.availableGrams} g.`);
      if (Array.isArray(p.allergens) && ingredient.allergens.some((id) => p.allergens.includes(id))) conflicts.push(`${ingredient.name} è fisso ma contiene un allergene escluso.`);
      if (Array.isArray(p.excludedIngredientIds) && p.excludedIngredientIds.includes(item.ingredientId)) conflicts.push(`${ingredient.name} è contemporaneamente fisso ed escluso.`);
      if (p.vegetarian && !ingredient.vegetarian) conflicts.push(`${ingredient.name} è fisso ma non vegetariano.`);
      if (item.ingredientId === "olive-oil" && item.dietGrams! > p.maxAddedFatGrams + EPSILON) conflicts.push("L'olio fisso supera il massimo di grassi aggiunti per porzione.");
      if (THERMOMETER_INGREDIENT_IDS.has(item.ingredientId) && Array.isArray(p.equipment) && !p.equipment.includes("thermometer")) {
        conflicts.push(`${ingredient.name} è fisso e richiede un termometro alimentare per verificare la temperatura al cuore. Aggiungi questo strumento all'attrezzatura soltanto se disponibile; il vincolo fisso non viene rimosso.`);
      }
    }
  }
  if (!Array.isArray(request.history) || request.history.some((entry) =>
    !entry || typeof entry.signature !== "string" || typeof entry.structuralSignature !== "string" ||
    typeof entry.templateId !== "string" || typeof entry.technique !== "string" ||
    typeof entry.cuisine !== "string" || typeof entry.createdAt !== "string" ||
    !Array.isArray(entry.ingredientIds) || entry.ingredientIds.some((id) => typeof id !== "string"))) {
    issues.push("Cronologia non valida.");
  }
  if (typeof request.nonce !== "string" || request.nonce.length > 200) issues.push("Identificatore di generazione non valido.");
  if (request.variant !== undefined) {
    const variant = request.variant;
    if (!variant || !["another", "faster", "protein", "lighter", "sweet", "substitute"].includes(variant.kind) ||
      !variant.baselineNutrition || NUTRIENTS.some((key) => !isFiniteNumber(variant.baselineNutrition[key]) || variant.baselineNutrition[key] < 0) ||
      !isFiniteNumber(variant.baselineMinutes) || variant.baselineMinutes <= 0 ||
      typeof variant.baselineRecipeId !== "string" || !variant.baselineRecipeId) {
      issues.push("La variante richiede nutrizione, tempo e identificatore validi della ricetta di partenza.");
    } else {
      if (variant.kind === "protein" && variant.baselineNutrition.protein <= 0) issues.push("La variante proteica richiede una base proteica maggiore di zero per misurare il +10%.");
      if (variant.kind === "lighter" && variant.baselineNutrition.kcal <= 0) issues.push("La variante leggera richiede calorie di partenza maggiori di zero.");
      if (variant.kind === "sweet" && p.taste === "savory") issues.push("Per una variante dolce imposta la preferenza di gusto su dolce.");
    }
  }
  if (issues.length) return failure("needs_input", "Controlla i dati prima di generare.", [...new Set(issues)]);
  if (conflicts.length) return failure("infeasible", "I vincoli della dispensa o della dieta sono in conflitto.", conflicts);
  if (!request.pantry.some((item) => item.availableGrams > 0)) return failure("needs_input", "La dispensa è vuota.", ["Aggiungi alimenti e disponibilità in grammi totali."]);
  return null;
}

function compatible(ingredient: Ingredient, request: GenerateRequest): boolean {
  const preferences = request.preferences;
  return (!preferences.vegetarian || ingredient.vegetarian) &&
    !preferences.excludedIngredientIds.includes(ingredient.id) &&
    !ingredient.allergens.some((id) => preferences.allergens.includes(id)) &&
    (!THERMOMETER_INGREDIENT_IDS.has(ingredient.id) || preferences.equipment.includes("thermometer"));
}

function recentHistory(history: RecipeFingerprint[]): RecipeFingerprint[] {
  return [...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
}

async function makeFingerprint(template: Template, items: Recipe["ingredients"], createdAt: string): Promise<RecipeFingerprint> {
  const core = items.filter((item) => !COSMETIC_ROLES.has(item.role)).map((item) => item.ingredientId).sort();
  return {
    signature: await hash([template.id, template.technique, core]),
    structuralSignature: await hash([template.family, template.technique, core]),
    templateId: template.id, ingredientIds: items.map((item) => item.ingredientId).sort(),
    technique: template.technique, cuisine: template.cuisine, createdAt,
  };
}

function deviations(nutrition: Nutrients, request: GenerateRequest): string[] {
  const result: string[] = [];
  for (const key of MACROS) {
    const target = request.targets[key];
    if (target === null) continue;
    const difference = nutrition[key] - target;
    if (Math.abs(difference) > tolerance(key, target) + EPSILON) {
      result.push(`${LABELS[key]}: ${round(nutrition[key], 1)} contro ${target} ${key === "kcal" ? "kcal" : "g"} per porzione (${difference > 0 ? "+" : ""}${round(difference, 1)}; tolleranza ±${round(tolerance(key, target), 1)}).`);
    }
  }
  if (request.targets.fiber !== null && nutrition.fiber + EPSILON < request.targets.fiber) {
    result.push(`Fibre: ${round(nutrition.fiber, 1)} g contro il minimo desiderato di ${request.targets.fiber} g per porzione; è un obiettivo morbido.`);
  }
  return result;
}

const poultryTransformations = ["poultry-fennel-crunch", "poultry-fennel-tartines"];

function isFixedPoultryMeal(request: GenerateRequest): boolean {
  const ids = new Set(request.pantry.filter((item) => item.mode === "fixed").map((item) => item.ingredientId));
  return ids.has("bread") && ids.has("fennel") && (ids.has("chicken") || ids.has("turkey"));
}

async function recipeScore(recipe: Recipe, template: Template, request: GenerateRequest, history: RecipeFingerprint[]): Promise<number> {
  let score = 0;
  for (const key of MACROS) {
    const target = request.targets[key];
    if (target !== null) score += Math.abs(recipe.nutritionPerServing[key] - target) / tolerance(key, target) * (key === "kcal" ? 2 : key === "protein" ? 1.5 : 1);
  }
  if (request.targets.fiber !== null) score += Math.max(0, request.targets.fiber - recipe.nutritionPerServing.fiber) * 0.3;
  const foodIds = new Set(recipe.fingerprint.ingredientIds);
  for (const item of request.pantry) if (item.mode === "preferred" && foodIds.has(item.ingredientId)) score -= 0.22;
  if (isFixedPoultryMeal(request) && poultryTransformations.includes(template.id)) {
    // Prefer a real transformation of this fixed meal over its plain fallback, not forced fridge extras.
    score -= 0.6;
  }
  if (!template.meals.includes(request.preferences.meal)) score += 0.4;
  const proteinShare = recipe.fit.proteinEnergyPercentage / 100;
  if (request.preferences.goal === "muscle") score -= proteinShare * 1.5;
  if (request.preferences.goal === "fat_loss") score -= proteinShare * 0.8 + Math.min(recipe.nutritionPerServing.fiber, 12) * 0.025;
  if (request.preferences.goal === "balanced" && recipe.ingredients.some((item) => getIngredient(item.ingredientId)!.category === "vegetable")) score -= 0.15;
  if (request.preferences.mealPrep) score += recipe.minutes * 0.005;
  for (const previous of history) {
    if (previous.structuralSignature === recipe.fingerprint.structuralSignature) score += 2;
    const previousCore = previous.ingredientIds.filter((id) => {
      const role = TEMPLATES.find((entry) => entry.id === previous.templateId)?.slots.find((slot) => slot.ids.includes(id))?.role;
      return !role || !COSMETIC_ROLES.has(role);
    });
    const currentCore = recipe.ingredients.filter((item) => !COSMETIC_ROLES.has(item.role)).map((item) => item.ingredientId);
    const shared = currentCore.filter((id) => previousCore.includes(id)).length;
    const union = new Set([...previousCore, ...currentCore]).size;
    if (union && shared / union >= 0.6) score += 1.2 * shared / union;
    if (previous.templateId === template.id) score += 0.7;
  }
  // Nonce only resolves close choices; it cannot overcome meaningful nutritional differences.
  score += parseInt((await hash([request.nonce, recipe.planHash])).slice(0, 8), 16) / 0xffffffff * 0.08;
  return score;
}

function verifyPlan(recipe: Recipe, template: Template, request: GenerateRequest): void {
  const p = request.preferences;
  for (const item of recipe.ingredients) {
    const pantry = request.pantry.find((entry) => entry.ingredientId === item.ingredientId);
    if (!pantry || item.grams <= 0 || item.grams > pantry.availableGrams + EPSILON || !compatible(getIngredient(item.ingredientId)!, request)) throw new Error("Il verificatore ha rilevato una violazione della dispensa.");
  }
  for (const item of request.pantry.filter((entry) => entry.mode === "fixed")) {
    const used = recipe.ingredients.find((entry) => entry.ingredientId === item.ingredientId)?.grams ?? 0;
    if (Math.abs(used - item.dietGrams! * p.servings) > EPSILON) throw new Error("Il verificatore ha rilevato una violazione della dieta fissa.");
  }
  const roleGrams = (role: string) => recipe.ingredients.filter((item) => item.role === role).reduce((sum, item) => sum + item.grams / p.servings, 0);
  for (const slot of template.slots) {
    const selected = recipe.ingredients.filter((item) => item.role === slot.role);
    if ((slot.required && !selected.length) || selected.length > slot.maxChoices ||
      selected.some((item) => item.grams / p.servings < slot.min - EPSILON || item.grams / p.servings > slot.max + EPSILON)) throw new Error("Il verificatore ha rilevato una porzione culinaria non valida.");
  }
  for (const ratio of template.ratios) {
    const numerator = roleGrams(ratio.numerator), denominator = roleGrams(ratio.denominator);
    if (numerator < ratio.min * denominator - EPSILON || numerator > ratio.max * denominator + EPSILON) throw new Error("Il verificatore ha rilevato un rapporto culinario non valido.");
  }
  if (template.id === "whey-drink" && roleGrams("acqua") > 0 &&
    roleGrams("acqua") < roleGrams("polvere") * 4 - EPSILON) {
    throw new Error("La bevanda di whey richiede almeno quattro parti d'acqua per una di polvere.");
  }
  if (recipe.fit.addedFatGrams > p.maxAddedFatGrams + EPSILON ||
    (request.targets.strictCalories && recipe.nutritionPerServing.kcal > request.targets.kcal! + EPSILON) ||
    (p.highProtein && recipe.fit.proteinEnergyPercentage < 25 - EPSILON) ||
    recipe.minutes > p.maxTime || recipe.steps.reduce((sum, step) => sum + step.minutes, 0) !== recipe.minutes) throw new Error("Il verificatore ha rilevato una violazione dei limiti.");
  if (request.variant?.kind === "protein" && recipe.nutritionPerServing.protein + EPSILON < request.variant.baselineNutrition.protein * 1.1) throw new Error("Variante proteica non migliorata.");
  if (request.variant?.kind === "lighter" && recipe.nutritionPerServing.kcal > request.variant.baselineNutrition.kcal * 0.9 + EPSILON) throw new Error("Variante leggera non migliorata.");
  if (request.variant?.kind === "faster" && recipe.minutes >= request.variant.baselineMinutes) throw new Error("Variante rapida non migliorata.");
}

async function makeRecipe(template: Template, planned: Awaited<ReturnType<typeof optimizeTemplate>> & {}, request: GenerateRequest, input: RecipeInput): Promise<Recipe> {
  const ingredients: Recipe["ingredients"] = planned.map((item) => {
    const food = getIngredient(item.ingredientId)!;
    return { ...item, name: food.name, state: food.state, nutrients: calculateNutrition([item]) };
  }).sort((a, b) => a.ingredientId.localeCompare(b.ingredientId));
  const total = calculateNutrition(ingredients);
  const nutrition = perServing(total, request.preferences.servings);
  const createdAt = new Date().toISOString();
  const steps = buildSteps(template, ingredients, request.preferences.servings);
  const fingerprint = await makeFingerprint(template, ingredients, createdAt);
  const planHash = await hash({
    catalog: CATALOG_VERSION, templateId: template.id, technique: template.technique,
    servings: request.preferences.servings,
    ingredients: ingredients.map(({ ingredientId, grams, state, role }) => ({ ingredientId, grams, state, role })),
    steps, nutritionTotal: total,
  });
  const warnings = [
    "Valori nutrizionali stimati, non analisi del prodotto: usa il peso nello stato indicato e verifica le etichette, inclusi allergeni e contaminazioni.",
    "Peso cotto e densità calorica non disponibili: assorbimento d'acqua e perdite di cottura non sono misurati. Non si usa la somma dei pesi crudi come peso cotto.",
  ];
  const unknownSugar = ingredients.some((item) => getIngredient(item.ingredientId)!.addedSugar === null);
  if (unknownSugar) warnings.push("Zuccheri aggiunti non determinabili per almeno un prodotto: il valore è sconosciuto, non zero. Verifica l'etichetta.");
  if (ingredients.some((item) => item.ingredientId === "cream-cheese")) warnings.push("Il formaggio spalmabile usa una stima generica per la versione classica, non i valori ufficiali Philadelphia. Verifica variante, grassi e altri nutrienti sull'etichetta; non considerare equivalenti le versioni light o vegetali.");
  const estimatedProducts = ingredients.filter((item) => PRODUCT_DEPENDENT_IDS.has(item.ingredientId));
  if (estimatedProducts.length) warnings.push(`Stime generiche dipendenti dal prodotto per: ${estimatedProducts.map((item) => item.name).join(", ")}. Non sono valori ufficiali di marche o confezioni: conferma composizione, stato, nutrienti e allergeni sull'etichetta; una variante light, condita o diversa non è equivalente.`);
  for (const item of ingredients.filter((entry) => ["seafood-salad", "protein-bar"].includes(entry.ingredientId))) {
    warnings.push(`${item.name}: ${getIngredient(item.ingredientId)!.source}`);
  }
  if (ingredients.some((item) => THERMOMETER_INGREDIENT_IDS.has(item.ingredientId))) warnings.push("I tempi comprendono preparazione e cottura ma restano stime: controlla la temperatura al cuore e prolunga se necessario.");
  if (ingredients.some((item) => item.ingredientId === "brown-rice")) warnings.push("Riso integrale pesato secco: sono previsti 35-45 minuti di cottura, circa 55 minuti totali per una porzione. Segui i tempi della confezione e prolunga se necessario; non sostituire con riso bianco o già cotto.");
  if (ingredients.some((item) => item.ingredientId === "smoked-salmon")) warnings.push("Il salmone affumicato è usato pronto al consumo, senza trattamento di sicurezza aggiuntivo. Per gravidanza, immunodepressione o altre condizioni di rischio segui le indicazioni sanitarie specifiche sui prodotti ittici refrigerati pronti.");
  const changes = deviations(nutrition, request);
  const additions = ingredients.filter((item) => item.ingredientId === "olive-oil").reduce((sum, item) => sum + item.grams, 0);
  const substitutions: Recipe["substitutions"] = [];
  for (const item of ingredients.filter((entry) => !COSMETIC_ROLES.has(entry.role))) {
    const slot = template.slots.find((entry) => entry.role === item.role)!;
    // Keep suggestions in the same culinary role AND state/technique group.
    const rawPoultry = ["chicken", "turkey"];
    const replacement = slot.ids.map(getIngredient).find((food) =>
      food && food.id !== item.ingredientId && !ingredients.some((entry) => entry.ingredientId === food.id) &&
      compatible(food, request) &&
      rawPoultry.includes(food.id) === rawPoultry.includes(item.ingredientId));
    if (!replacement) continue;
    const stock = request.pantry.find((entry) => entry.ingredientId === replacement.id)?.availableGrams ?? 0;
    substitutions.push({
      ingredientId: item.ingredientId, replacementId: replacement.id,
      description: `${replacement.name} è compatibile con il ruolo «${item.role}». ${stock >= item.grams ? `In dispensa: ${stock} g totali.` : `Da acquistare o integrare: disponibilità attuale ${stock} g totali.`} Non è uno scambio nutrizionale 1:1: rigenera e verifica quantità, stato e cottura${request.pantry.find((entry) => entry.ingredientId === item.ingredientId)?.mode === "fixed" ? "; prima modifica esplicitamente il vincolo fisso" : ""}.`,
    });
    if (substitutions.length === 3) break;
  }
  const title = buildTitle(template, ingredients);
  let description = template.description;
  if (template.id === "one-pan-rice") {
    description = "Cereale secco cotto per assorbimento con bocconcini e verdure, con porzioni ottimizzate sui tuoi vincoli.";
  }
  if (template.id === "poached-rice-salad") {
    description = "Cottura delicata in acqua e condimento cremoso fuori dal fuoco, senza rosolatura.";
  }
  if (["yogurt-fruit-parfait", "cocoa-banana-cream"].includes(template.id)) {
    description = "Preparazione fresca al cucchiaio, con ingredienti pesati, senza addensanti nascosti e senza attese notturne.";
  }
  const recipe: Recipe = {
    id: `recipe-${planHash.slice(0, 24)}`, createdAt, title, description,
    templateId: template.id, family: template.family, cuisine: template.cuisine,
    technique: template.technique, minutes: steps.reduce((sum, step) => sum + step.minutes, 0),
    difficulty: template.difficulty, servings: request.preferences.servings,
    ingredients, steps, nutritionPerServing: nutrition, nutritionTotal: total,
    targetStatus: changes.length ? "closest" : "matched", deviations: changes, warnings,
    tips: [
      "Tutti i grammi degli ingredienti sono TOTALI; obiettivi, quantità fisse della dieta e valori nutrizionali per porzione si riferiscono a una sola porzione. Dividi la preparazione uniformemente.",
      "Sono usati solo alimenti della dispensa; l'acqua potabile di cottura o ricostituzione è indicata esplicitamente in ml, oppure in grammi se già pesata nella dispensa. Nessun condimento è sottinteso.",
      `Grassi aggiunti: ${round(additions / request.preferences.servings, 1)} g per porzione. I grassi già presenti negli alimenti sono comunque inclusi nei macronutrienti.`,
      "Il goal orienta la scelta tra ricette, non prescrive deficit calorici o diete mediche.",
      ...(request.preferences.highProtein ? ["Alto contenuto proteico: almeno il 25% dell'energia stimata proviene dalle proteine (4 kcal per grammo)."] : []),
      ...(request.preferences.mealPrep ? [
        `Per il meal prep, trasferisci subito in contenitori bassi e refrigera entro 2 ore (≤4 °C); consuma entro 24 ore per le preparazioni con riso, entro 48 ore per le altre. I minuti indicano preparazione e cottura, non conservazione. ${request.preferences.equipment.includes("thermometer")
          ? "Riscalda le preparazioni cotte a 74 °C una sola volta, verificando con il termometro alimentare."
          : "Dopo la corretta refrigerazione, consuma questa preparazione fredda: non è previsto un riscaldamento senza controllo della temperatura al cuore."} Conserva separati eventuali condimenti freschi.`,
      ] : []),
    ],
    substitutions,
    variantTip: request.variant
      ? `Variante «${request.variant.kind}» verificata rispetto ai dati di partenza; i target ricevuti non sono stati modificati dal motore.`
      : "Per una variante, modifica i target desiderati e passa i valori della ricetta di partenza; il motore verifica il miglioramento reale.",
    fingerprint, sourceMode: "editorial", planHash,
    fit: {
      addedFatGrams: round(additions / request.preferences.servings),
      addedSugarGrams: unknownSugar ? null : round(ingredients.reduce((sum, item) => sum + getIngredient(item.ingredientId)!.addedSugar! * item.grams / 100, 0) / request.preferences.servings),
      estimatedCookedWeightGrams: null, caloricDensity: null,
      proteinEnergyPercentage: nutrition.kcal > 0 ? round(nutrition.protein * 4 / nutrition.kcal * 100) : 0,
      nutritionSource: NUTRITION_SOURCE,
    },
    input: structuredClone(input),
  };
  verifyPlan(recipe, template, request);
  return recipe;
}

export async function generateRecipe(request: GenerateRequest): Promise<GenerationResponse> {
  const invalid = validate(request);
  if (invalid) return invalid;
  // Capture before awaiting WASM: callers cannot change the input or constraints mid-generation.
  request = structuredClone(request);
  const input: RecipeInput = {
    pantry: structuredClone(request.pantry),
    targets: structuredClone(request.targets),
    preferences: structuredClone(request.preferences),
  };
  const pantry: PantryItem[] = request.pantry.filter((item) =>
    item.availableGrams > 0 && compatible(getIngredient(item.ingredientId)!, request),
  ).sort((a, b) => a.ingredientId.localeCompare(b.ingredientId));
  if (!pantry.length) return failure("infeasible", "Nessun alimento utilizzabile con esclusioni e attrezzatura attuali.", [
    "Aggiungi alimenti compatibili senza rimuovere vincoli di sicurezza.",
    ...(!request.preferences.equipment.includes("thermometer") && request.pantry.some((item) => THERMOMETER_INGREDIENT_IDS.has(item.ingredientId))
      ? ["Pollo e tacchino crudi, uova, albume, macinato di manzo e merluzzo crudo richiedono un termometro alimentare per queste preparazioni verificate."] : []),
  ]);
  const history = recentHistory(request.history);
  const candidates: Array<{ recipe: Recipe; score: number; repeat: boolean }> = [];
  const templates = TEMPLATES.filter((template) => {
    const p = request.preferences;
    const minutes = template.minutes + template.extraServingMinutes * (p.servings - 1);
    return (p.taste === "either" || template.taste === p.taste) &&
      (request.variant?.kind !== "sweet" || template.taste === "sweet") &&
      template.equipment.every((tool) => p.equipment.includes(tool)) &&
      (p.difficulty === "medium" || template.difficulty === "easy") &&
      minutes <= p.maxTime &&
      (!p.mealPrep || (template.mealPrep && p.equipment.includes("refrigerator") && minutes <= 35)) &&
      (request.variant?.kind !== "faster" || minutes < request.variant.baselineMinutes);
  });
  for (const template of templates) {
    const planned = await optimizeTemplate(template, pantry, request);
    if (!planned) continue;
    const base = await makeRecipe(template, planned, request, input);
    const isRepeat = (recipe: Recipe) => history.some((entry) => entry.signature === recipe.fingerprint.signature) ||
      (request.variant?.kind === "another" && recipe.id === request.variant.baselineRecipeId);
    candidates.push({ recipe: base, score: await recipeScore(base, template, request, history), repeat: isRepeat(base) });
    if (isRepeat(base)) {
      const forbidden = history.filter((entry) => entry.templateId === template.id).map((entry) => entry.ingredientIds);
      forbidden.push(base.fingerprint.ingredientIds);
      const alternative = await optimizeTemplate(template, pantry, request, forbidden);
      if (alternative) {
        const recipe = await makeRecipe(template, alternative, request, input);
        candidates.push({ recipe, score: await recipeScore(recipe, template, request, history), repeat: isRepeat(recipe) });
      }
    }
  }
  if (!candidates.length) {
    const details = [
      "Nessun archetipo culinario verificato rispetta insieme ingredienti, disponibilità totale, quantità fisse, attrezzatura, tempo e rapporti tra ingredienti. Non sono stati aggiunti alimenti mancanti.",
      ...(!request.preferences.equipment.includes("thermometer") && request.pantry.some((item) => item.availableGrams > 0 && THERMOMETER_INGREDIENT_IDS.has(item.ingredientId))
        ? ["Manca il termometro alimentare: pollo e tacchino crudi, uova, albume, macinato di manzo e merluzzo crudo non sono utilizzati perché richiedono la verifica della temperatura al cuore. Restano ammesse le alternative già cotte o pronte al consumo."] : []),
      ...(request.targets.strictCalories ? [`Il massimo rigido di ${request.targets.kcal} kcal per porzione non è stato superato per forzare un risultato.`] : []),
      ...(request.preferences.highProtein ? ["L'opzione alto contenuto proteico richiede almeno il 25% dell'energia dalle proteine."] : []),
      ...(request.preferences.mealPrep ? ["Meal prep richiede frigorifero e una preparazione completa entro 35 minuti, senza ammollo notturno."] : []),
      ...(request.variant ? [
        request.variant.kind === "protein" ? `Impossibile garantire almeno +10% di proteine: servono almeno ${round(request.variant.baselineNutrition.protein * 1.1, 2)} g per porzione.` :
          request.variant.kind === "lighter" ? `Impossibile garantire almeno -10% di calorie: massimo ${round(request.variant.baselineNutrition.kcal * 0.9, 2)} kcal per porzione.` :
            request.variant.kind === "faster" ? `Serve una ricetta strettamente più breve di ${request.variant.baselineMinutes} minuti.` :
              "Nessuna preparazione compatibile con la variante richiesta.",
      ] : []),
      "Puoi aggiungere disponibilità, scegliere un altro tempo o rivedere volontariamente i target. Allergeni ed esclusioni restano sempre rispettati.",
    ];
    return failure("infeasible", request.variant ? "Questa variante non è realizzabile con i vincoli attuali." : "Nessuna ricetta verificata è realizzabile con questi vincoli.", details);
  }
  const transformed = candidates.filter((entry) => poultryTransformations.includes(entry.recipe.templateId));
  // A bland fallback must not become the next "creative" idea merely because its fingerprint is new.
  const eligible = isFixedPoultryMeal(request) && transformed.length
    ? candidates.filter((entry) => entry.recipe.templateId !== "poultry-fennel-plate"
      || (entry.recipe.targetStatus === "matched" && transformed.every((candidate) => candidate.recipe.targetStatus !== "matched")))
    : candidates;
  const unique = eligible.filter((entry) => !entry.repeat);
  const pool = unique.length ? unique : eligible;
  pool.sort((a, b) => a.score - b.score || a.recipe.planHash.localeCompare(b.recipe.planHash));
  const selected = pool[0].recipe;
  if (!unique.length) {
    selected.warnings.push("Ripetizione esplicita: tutte le strutture realizzabili sono già nelle ultime 20 ricette o coincidono con la base. Questa è una ripetizione, non una nuova ricetta; i vincoli nutrizionali non sono dichiarati impossibili per la sola cronologia.");
    selected.variantTip = "Con questi vincoli restano solo preparazioni già proposte. Aggiungi ingredienti compatibili o cambia volontariamente preferenze per ottenere vera varietà.";
  }
  if (selected.targetStatus === "closest") selected.warnings.push("Soluzione più vicina trovata tra gli archetipi verificati: uno o più target morbidi sono fuori tolleranza. Il limite calorico rigido, se impostato, resta rispettato.");
  return { status: "ok", recipe: selected };
}
