import assert from "node:assert/strict";
import test from "node:test";
import { catalogFood } from "../src/lib/nutrition-diary";
import { personalRecipeSchema, recipeFood, recipeNutrition } from "../src/lib/personal-recipe";
import { emptyNutritionState, nutritionStateSchema } from "../src/lib/nutrition-state";
import { emptyWeeklyDraft, resolveWeeklyMeal } from "../src/lib/weekly-diet";
import { plannedDay } from "../src/lib/daily-plan";
import { syntheticWeeklyPlan } from "./fixtures/weekly-plan";

test("homemade recipe calculates cooked yield and preserves ingredient snapshots", () => {
  const recipe = personalRecipeSchema.parse({
    id: "8e3fd074-dd45-4df1-8b17-d6ce4f1c5f2b",
    name: "Pancake di test",
    createdAt: "2026-10-30T08:00:00.000Z",
    servings: 4, cookedWeightGrams: 200,
    items: [{ food: catalogFood("wheat-flour"), grams: 100 }, { food: catalogFood("eggs"), grams: 100 }],
  });
  const nutrition = recipeNutrition(recipe);
  assert.equal(nutrition.servingGrams, 50);
  assert.equal(nutrition.total.kcal, 486);
  assert.equal(nutrition.perServing.kcal, 121.5);
  assert.equal(recipeFood(recipe).per100g.kcal, 243);
  assert.equal(nutrition.per100g.protein, (11 + 12.6)/2);
  const parsed = nutritionStateSchema.parse({ ...emptyNutritionState(), personalRecipes: [recipe], savedFoods: [recipeFood(recipe)] });
  assert.equal(parsed.personalRecipes?.length, 1);
  assert.equal(parsed.savedFoods?.[0].id, "recipe-" + recipe.id);
});

test("personal recipe substitutions work in meal resolution and day preview without altering base plan", () => {
  const plan = syntheticWeeklyPlan();
  const recipe = personalRecipeSchema.parse({
    id: "8e3fd074-dd45-4df1-8b17-d6ce4f1c5f2b", name: "Pancake di test",
    createdAt: "2026-10-30T08:00:00.000Z", servings: 2, cookedWeightGrams: 100,
    items: [{ food: catalogFood("wheat-flour"), grams: 80 }],
  });
  const food = recipeFood(recipe);
  plan.monday.breakfast = { original:"Pancake", taste:"sweet", slots:[{id:"pancake", label:"2 pancake", options:[{ingredientId:"ready-pancakes", grams:null}]}] };
  const draft = { ...emptyWeeklyDraft(), confirmed:true, substitutions:{pancake:food.id}, grams:{"pancake-"+food.id:"100"} };
  const meal = resolveWeeklyMeal("monday","breakfast",draft,plan,[food]);
  assert.deepEqual(meal.errors,[]);
  assert.equal(meal.items[0].ingredientId,food.id);
  const before = JSON.stringify(plan);
  const state = {version:1 as const,day:"monday" as const,meal:"breakfast" as const,plan,drafts:{"monday-breakfast":draft}};
  const preview = plannedDay(state,"monday",new Set(),[food]);
  assert.ok(preview.items.some(x=>x.ingredientId===food.id));
  assert.equal(JSON.stringify(plan),before);
});

test("recipe rejects unquantified or duplicated ingredients", () => {
  const recipe = { id:"8e3fd074-dd45-4df1-8b17-d6ce4f1c5f2b",name:"A",createdAt:"2026-10-30T08:00:00.000Z",servings:2,cookedWeightGrams:100,
    items:[{food:catalogFood("wheat-flour"),grams:80}] };
  assert.equal(personalRecipeSchema.safeParse({...recipe,items:[recipe.items[0],recipe.items[0]]}).success,false);
  assert.equal(personalRecipeSchema.safeParse({...recipe,cookedWeightGrams:0}).success,false);
});
