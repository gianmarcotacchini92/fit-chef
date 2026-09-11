import { z } from "zod";
import { GENERATION_HISTORY_LIMIT } from "./recipe-history";
import type { GenerateRequest, LocalState, Recipe, WeeklyPlan } from "./types";

const text = (max: number) => z.string().min(1).max(max).refine(
  (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
  "Il testo contiene caratteri non validi.",
);
const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const finite = (max: number) => z.number().finite().min(0).max(max);
const date = z.iso.datetime({ offset: true });
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const ids = (max: number) => z.array(id).max(max).refine(unique, "Identificativi duplicati.");
const allergen = z.enum([
  "gluten", "milk", "eggs", "fish", "soy", "peanuts", "nuts", "sesame",
  "crustaceans", "molluscs", "celery", "mustard", "sulphites", "lupin",
]);
const equipment = z.enum([
  "pan", "stove", "oven", "air_fryer", "blender", "microwave", "refrigerator", "thermometer",
]);

export const nutrientsSchema = z.strictObject({
  kcal: finite(1_000_000),
  protein: finite(100_000),
  carbs: finite(100_000),
  fat: finite(100_000),
  fiber: finite(100_000),
});

const pantryItemSchema = z.strictObject({
  ingredientId: id,
  availableGrams: finite(50_000),
  mode: z.enum(["available", "fixed", "preferred"]),
  dietGrams: finite(5_000).optional(),
}).superRefine((item, ctx) => {
  if (item.mode === "fixed" && !(typeof item.dietGrams === "number" && item.dietGrams > 0)) {
    ctx.addIssue({
      code: "custom", path: ["dietGrams"],
      message: "Un alimento bloccato richiede una quantita positiva per porzione.",
    });
  }
});

export const recipeInputSchema = z.strictObject({
  pantry: z.array(pantryItemSchema).max(60).refine(
    (items) => unique(items.map((item) => item.ingredientId)),
    "Ogni alimento puo comparire una sola volta.",
  ),
  targets: z.strictObject({
    kcal: finite(10_000).nullable(),
    protein: finite(1_000).nullable(),
    carbs: finite(1_000).nullable(),
    fat: finite(1_000).nullable(),
    fiber: finite(300).nullable(),
    strictCalories: z.boolean(),
  }),
  preferences: z.strictObject({
    goal: z.enum(["fat_loss", "muscle", "maintenance", "balanced"]),
    taste: z.enum(["savory", "sweet", "either"]),
    meal: z.enum(["breakfast", "lunch", "dinner", "snack", "dessert"]),
    maxTime: z.number().int().min(1).max(240),
    servings: z.number().int().min(1).max(12),
    difficulty: z.enum(["easy", "medium"]),
    equipment: z.array(equipment).max(8).refine(unique, "Attrezzature duplicate."),
    allergens: z.array(allergen).max(14).refine(unique, "Allergeni duplicati."),
    excludedIngredientIds: ids(100),
    vegetarian: z.boolean(),
    highProtein: z.boolean(),
    mealPrep: z.boolean(),
    maxAddedFatGrams: finite(500),
  }),
});

const fingerprintSchema = z.strictObject({
  signature: text(2_000),
  structuralSignature: text(2_000),
  templateId: id,
  ingredientIds: ids(60),
  technique: text(120),
  cuisine: text(120),
  createdAt: date,
});

export const generationRequestSchema = recipeInputSchema.extend({
  history: z.array(fingerprintSchema).max(GENERATION_HISTORY_LIMIT),
  nonce: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/),
  variant: z.strictObject({
    kind: z.enum(["another", "faster", "protein", "lighter", "sweet", "substitute"]),
    baselineNutrition: nutrientsSchema,
    baselineMinutes: finite(240),
    baselineRecipeId: id,
  }).optional(),
}) satisfies z.ZodType<GenerateRequest>;

const messages = (max: number) => z.array(text(1_000)).max(max);
export const imageReferenceSchema = z.strictObject({
  url: z.string().max(100).regex(/^\/api\/images\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/),
  kind: z.literal("ai"),
  planHash: text(200),
});

export const recipeSchema = z.strictObject({
  id,
  createdAt: date,
  title: text(160),
  description: text(1_500),
  templateId: id,
  family: z.enum(["bowl", "wrap", "pancakes", "dessert", "salad", "frittata", "patties", "pasta"]),
  cuisine: text(120),
  technique: text(120),
  minutes: finite(240),
  difficulty: z.enum(["easy", "medium"]),
  servings: z.number().int().min(1).max(12),
  ingredients: z.array(z.strictObject({
    ingredientId: id,
    name: text(160),
    grams: finite(50_000).refine((value) => value > 0, "Quantita non positiva."),
    state: text(160),
    role: text(160),
    nutrients: nutrientsSchema,
  })).min(1).max(60).refine(
    (items) => unique(items.map((item) => item.ingredientId)),
    "Ingredienti duplicati.",
  ),
  steps: z.array(z.strictObject({
    id,
    title: text(160),
    instruction: text(3_000),
    minutes: finite(240),
  })).min(1).max(30).refine(
    (steps) => unique(steps.map((step) => step.id)),
    "Passaggi duplicati.",
  ),
  nutritionPerServing: nutrientsSchema,
  nutritionTotal: nutrientsSchema,
  targetStatus: z.enum(["matched", "closest"]),
  deviations: messages(30),
  warnings: messages(30),
  tips: messages(30),
  substitutions: z.array(z.strictObject({
    ingredientId: id,
    replacementId: id,
    description: text(1_000),
  })).max(60),
  variantTip: text(1_000),
  fingerprint: fingerprintSchema,
  sourceMode: z.enum(["editorial", "ai"]),
  image: imageReferenceSchema.optional(),
  planHash: text(200),
  fit: z.strictObject({
    addedFatGrams: finite(6_000),
    addedSugarGrams: finite(60_000).nullable(),
    estimatedCookedWeightGrams: finite(600_000).nullable(),
    caloricDensity: finite(10_000).nullable(),
    proteinEnergyPercentage: finite(100),
    nutritionSource: text(1_000),
  }),
  input: recipeInputSchema,
}).superRefine((recipe, ctx) => {
  if (recipe.image && recipe.image.planHash !== recipe.planHash) {
    ctx.addIssue({ code: "custom", path: ["image"], message: "Immagine di un piano diverso." });
  }
}) satisfies z.ZodType<Recipe>;

const weeklyOptionSchema = z.strictObject({
  ingredientId: id,
  grams: z.number().finite().positive().max(5_000).nullable(),
  label: text(160).optional(),
});
const weeklySlotSchema = z.strictObject({
  id,
  label: text(160),
  options: z.array(weeklyOptionSchema).min(1).max(30).refine(
    (options) => unique(options.map((option) => option.ingredientId)), "Alternative duplicate.",
  ),
  note: text(1_000).optional(),
});
const weeklyMealSchema = z.strictObject({
  original: text(3_000),
  slots: z.array(weeklySlotSchema).max(30).refine(
    (slots) => unique(slots.map((slot) => slot.id)), "Voci del pasto duplicate.",
  ),
  taste: z.enum(["sweet", "savory", "either"]),
  freeChoice: z.literal(true).optional(),
  note: text(1_000).optional(),
  suggestedMaxTime: z.number().int().min(1).max(240).optional(),
  extraServingMinutes: z.number().int().min(0).max(60).optional(),
}).superRefine((meal, ctx) => {
  if (meal.freeChoice ? meal.slots.length !== 0 : meal.slots.length === 0) {
    ctx.addIssue({ code: "custom", path: ["slots"], message: "Solo un pasto libero puo non avere alimenti; un pasto libero non puo prescriverne." });
  }
  const quantityKeys = meal.slots.flatMap((slot) => slot.options.map((option) => `${slot.id}-${option.ingredientId}`));
  if (!unique(quantityKeys)) {
    ctx.addIssue({ code: "custom", path: ["slots"], message: "Identificativi ambigui: due alternative condividono lo stesso campo quantita." });
  }
});
const weeklyDaySchema = z.strictObject({
  breakfast: weeklyMealSchema, lunch: weeklyMealSchema, snack: weeklyMealSchema, dinner: weeklyMealSchema,
});
export const weeklyPlanSchema = z.strictObject({
  monday: weeklyDaySchema, tuesday: weeklyDaySchema, wednesday: weeklyDaySchema,
  thursday: weeklyDaySchema, friday: weeklyDaySchema, saturday: weeklyDaySchema, sunday: weeklyDaySchema,
}) satisfies z.ZodType<WeeklyPlan>;

const weeklyKey = z.string().regex(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)-(breakfast|lunch|snack|dinner)$/);
const weeklyDraftId = z.string().min(1).max(201).regex(/^[a-zA-Z0-9_-]+$/);
const draftValues = (max: number) => z.record(weeklyDraftId, z.string().max(100)).refine(
  (values) => Object.keys(values).length <= max, "Troppe voci nel pasto.",
);
export const weeklyDietStateSchema = z.strictObject({
  version: z.literal(1),
  day: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
  meal: z.enum(["breakfast", "lunch", "snack", "dinner"]),
  drafts: z.record(weeklyKey, z.strictObject({
    choices: draftValues(30),
    grams: draftValues(900),
    confirmed: z.boolean(),
  })).refine((drafts) => Object.keys(drafts).length <= 28, "Troppi pasti nella settimana."),
  appliedKey: weeklyKey.optional(),
  plan: weeklyPlanSchema.optional(),
});

export const localStateSchema = z.strictObject({
  version: z.literal(1),
  input: recipeInputSchema,
  recipes: z.array(recipeSchema).max(100).refine(
    (recipes) => unique(recipes.map((recipe) => recipe.id)),
    "Ricette duplicate.",
  ),
  favoriteIds: ids(50),
  cookedIds: ids(100),
  weeklyDiet: weeklyDietStateSchema.optional(),
  builderMode: z.enum(["weekly", "meal", "pantry"]).optional(),
}).superRefine((state, ctx) => {
  const present = new Set(state.recipes.map((recipe) => recipe.id));
  for (const field of ["favoriteIds", "cookedIds"] as const) {
    if (state[field].some((recipeId) => !present.has(recipeId))) {
      ctx.addIssue({ code: "custom", path: [field], message: "Riferimento a una ricetta assente." });
    }
  }
}) satisfies z.ZodType<LocalState>;

export const imageRequestSchema = z.union([
  z.strictObject({ recipeId: id, planHash: text(200) }),
  z.strictObject({ recipe: recipeSchema }).transform(({ recipe }) => ({
    recipeId: recipe.id, planHash: recipe.planHash,
  })),
]);
