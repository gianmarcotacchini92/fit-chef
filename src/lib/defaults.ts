import type { RecipeInput } from "./types";

export const DEFAULT_INPUT: RecipeInput = {
  pantry: [
    { ingredientId: "chicken", availableGrams: 200, mode: "available" },
    { ingredientId: "rice", availableGrams: 100, mode: "available" },
    { ingredientId: "zucchini", availableGrams: 250, mode: "available" },
    { ingredientId: "greek-yogurt", availableGrams: 170, mode: "available" },
    { ingredientId: "olive-oil", availableGrams: 10, mode: "available" },
    { ingredientId: "lemon", availableGrams: 30, mode: "available" },
    { ingredientId: "paprika", availableGrams: 3, mode: "available" },
    { ingredientId: "salt", availableGrams: 2, mode: "available" },
  ],
  targets: {
    kcal: 500,
    protein: 40,
    carbs: 50,
    fat: 14,
    fiber: null,
    strictCalories: false,
  },
  preferences: {
    goal: "balanced",
    taste: "savory",
    meal: "lunch",
    maxTime: 35,
    servings: 1,
    difficulty: "easy",
    equipment: ["pan", "stove", "refrigerator", "blender", "thermometer"],
    allergens: [],
    excludedIngredientIds: [],
    vegetarian: false,
    highProtein: false,
    mealPrep: false,
    maxAddedFatGrams: 10,
  },
};

export const DEFAULT_MEAL_INPUT: RecipeInput = {
  pantry: [],
  targets: {
    kcal: null,
    protein: null,
    carbs: null,
    fat: null,
    fiber: null,
    strictCalories: false,
  },
  preferences: { ...DEFAULT_INPUT.preferences },
};

export const NUTRIENT_LABELS = {
  kcal: "Calorie",
  protein: "Proteine",
  carbs: "Carboidrati",
  fat: "Grassi",
  fiber: "Fibre",
} as const;

export const EQUIPMENT_LABELS = {
  pan: "Padella antiaderente con coperchio",
  stove: "Fornelli",
  oven: "Forno",
  air_fryer: "Friggitrice ad aria",
  blender: "Mixer",
  microwave: "Microonde",
  refrigerator: "Frigorifero",
  thermometer: "Termometro alimentare",
} as const;

export const ALLERGENS = [
  { id: "gluten", label: "Glutine" },
  { id: "milk", label: "Latte" },
  { id: "eggs", label: "Uova" },
  { id: "fish", label: "Pesce" },
  { id: "soy", label: "Soia" },
  { id: "peanuts", label: "Arachidi" },
  { id: "nuts", label: "Frutta a guscio" },
  { id: "sesame", label: "Sesamo" },
  { id: "crustaceans", label: "Crostacei" },
  { id: "molluscs", label: "Molluschi" },
  { id: "celery", label: "Sedano" },
  { id: "mustard", label: "Senape" },
  { id: "sulphites", label: "Solfiti" },
  { id: "lupin", label: "Lupini" },
] as const;
