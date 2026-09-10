export type Nutrients = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
};

export type IngredientCategory =
  | "protein"
  | "carb"
  | "vegetable"
  | "fruit"
  | "dairy"
  | "fat"
  | "pantry";

export type Ingredient = {
  id: string;
  name: string;
  aliases: string[];
  emoji: string;
  category: IngredientCategory;
  state: string;
  nutrients: Nutrients;
  allergens: string[];
  vegetarian: boolean;
  addedSugar: number | null;
  defaultGrams: number;
  source: string;
};

export type PantryItem = {
  ingredientId: string;
  availableGrams: number;
  mode: "available" | "fixed" | "preferred";
  dietGrams?: number;
};

export type Targets = {
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  strictCalories: boolean;
};

export type Equipment =
  | "pan"
  | "stove"
  | "oven"
  | "air_fryer"
  | "blender"
  | "microwave"
  | "refrigerator"
  | "thermometer";

export type Preferences = {
  goal: "fat_loss" | "muscle" | "maintenance" | "balanced";
  taste: "savory" | "sweet" | "either";
  meal: "breakfast" | "lunch" | "dinner" | "snack" | "dessert";
  maxTime: number;
  servings: number;
  difficulty: "easy" | "medium";
  equipment: Equipment[];
  allergens: string[];
  excludedIngredientIds: string[];
  vegetarian: boolean;
  highProtein: boolean;
  mealPrep: boolean;
  maxAddedFatGrams: number;
};

export type RecipeFingerprint = {
  signature: string;
  structuralSignature: string;
  templateId: string;
  ingredientIds: string[];
  technique: string;
  cuisine: string;
  createdAt: string;
};

export type RecipeInput = {
  pantry: PantryItem[];
  targets: Targets;
  preferences: Preferences;
};

export type VariantRequest = {
  kind: "another" | "faster" | "protein" | "lighter" | "sweet" | "substitute";
  baselineNutrition: Nutrients;
  baselineMinutes: number;
  baselineRecipeId: string;
};

export type GenerateRequest = RecipeInput & {
  history: RecipeFingerprint[];
  nonce: string;
  variant?: VariantRequest;
};

export type RecipeItem = {
  ingredientId: string;
  name: string;
  grams: number;
  state: string;
  role: string;
  nutrients: Nutrients;
};

export type RecipeStep = {
  id: string;
  title: string;
  instruction: string;
  minutes: number;
};

export type Recipe = {
  id: string;
  createdAt: string;
  title: string;
  description: string;
  templateId: string;
  family: "bowl" | "wrap" | "pancakes" | "dessert" | "salad" | "frittata" | "patties" | "pasta";
  cuisine: string;
  technique: string;
  minutes: number;
  difficulty: "easy" | "medium";
  servings: number;
  ingredients: RecipeItem[];
  steps: RecipeStep[];
  nutritionPerServing: Nutrients;
  nutritionTotal: Nutrients;
  targetStatus: "matched" | "closest";
  deviations: string[];
  warnings: string[];
  tips: string[];
  substitutions: {
    ingredientId: string;
    replacementId: string;
    description: string;
  }[];
  variantTip: string;
  fingerprint: RecipeFingerprint;
  sourceMode: "editorial" | "ai";
  image?: { url: string; kind: "ai"; planHash: string };
  planHash: string;
  fit: {
    addedFatGrams: number;
    addedSugarGrams: number | null;
    estimatedCookedWeightGrams: number | null;
    caloricDensity: number | null;
    proteinEnergyPercentage: number;
    nutritionSource: string;
  };
  input: RecipeInput;
};

export type GenerationResponse =
  | { status: "ok"; recipe: Recipe }
  | { status: "needs_input" | "infeasible" | "error"; message: string; details: string[] };

export type LocalState = {
  version: 1;
  input: RecipeInput;
  recipes: Recipe[];
  favoriteIds: string[];
  cookedIds: string[];
  weeklyDiet?: WeeklyDietState;
  builderMode?: "weekly" | "meal" | "pantry";
};

export type WeekDay = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
export type WeekMeal = "breakfast" | "lunch" | "snack" | "dinner";
export type WeeklyOption = { ingredientId: string; grams: number | null; label?: string };
export type WeeklySlot = { id: string; label: string; options: WeeklyOption[]; note?: string };
export type WeeklyMeal = {
  original: string;
  slots: WeeklySlot[];
  taste: Preferences["taste"];
  freeChoice?: true;
  note?: string;
  suggestedMaxTime?: number;
  extraServingMinutes?: number;
};
export type WeeklyPlan = Record<WeekDay, Record<WeekMeal, WeeklyMeal>>;
export type WeeklyMealDraft = {
  choices: Record<string, string>;
  grams: Record<string, string>;
  confirmed: boolean;
};
export type WeeklyDietState = {
  version: 1;
  day: WeekDay;
  meal: WeekMeal;
  drafts: Record<string, WeeklyMealDraft>;
  appliedKey?: string;
  plan?: WeeklyPlan;
};
