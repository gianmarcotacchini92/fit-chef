import type { WeeklyMeal, WeeklyPlan, WeeklySlot } from "../../src/lib/types";
import { WEEK_DAYS, WEEK_MEALS } from "../../src/lib/weekly-diet";

// Artificial test data, deliberately unrelated to any person's calendar or prescribed weights.
const slot = (id: string, grams: number | null, label = id): WeeklySlot => ({
  id, label, options: [{ ingredientId: id, grams }],
});
const meal = (original: string, slots: WeeklySlot[], taste: WeeklyMeal["taste"] = "savory"): WeeklyMeal => ({
  original, slots, taste,
});

export function syntheticWeeklyPlan(): WeeklyPlan {
  const plan = Object.fromEntries(WEEK_DAYS.map(({ id }) => [id, Object.fromEntries(
    WEEK_MEALS.map(({ id: mealId }) => [mealId, {
      original: "Scelta libera di prova", slots: [], taste: "either", freeChoice: true,
    }]),
  )])) as unknown as WeeklyPlan;
  plan.monday.breakfast = meal("Bevanda di prova", [slot("coffee", null, "Caffe di prova"), slot("whey", null, "Polvere di prova")], "sweet");
  plan.monday.dinner = meal("Ciotola cereali di prova", [
    slot("coffee", null), slot("greek-yogurt", 165),
    { id: "cereals", label: "Cereali di prova", options: [{ ingredientId: "breakfast-cereal", grams: 32 }, { ingredientId: "oats", grams: 32 }] },
    slot("dark-chocolate", 13), slot("cocoa", null),
  ], "sweet");
  plan.tuesday.breakfast = meal("Pane farcito di prova", [
    slot("coffee", null, "Caffe di prova"), slot("bread", 63), slot("cooked-ham", 38), slot("cheese-slice", null, "Fetta di prova"),
  ]);
  plan.tuesday.lunch = meal("Involtino di prova: 76 g piadina e uova da pesare", [
    slot("lettuce", null, "Insalata di prova"), slot("plain-wrap", 76), slot("eggs", null, "Uova da pesare"),
  ]);
  plan.tuesday.snack = meal("Frutta e polvere di prova", [
    { id: "fruit", label: "Frutta di prova", options: ["apple", "banana", "strawberries", "berries"].map((ingredientId) => ({ ingredientId, grams: null })) },
    slot("whey", 24),
  ], "sweet");
  plan.wednesday.breakfast = meal("Pancake di prova da pesare", [
    slot("coffee", null), slot("ready-pancakes", null), slot("jam", 17), slot("peanut-butter", 11),
  ], "sweet");
  plan.wednesday.lunch = { ...meal("Riso e salmone di prova", [
    slot("zucchini", null, "Zucchine di prova"), slot("brown-rice", 68), slot("smoked-salmon", 82),
  ]), suggestedMaxTime: 55, extraServingMinutes: 4 };
  plan.wednesday.snack = meal("Merenda confezionata di prova", [slot("banana", null), slot("protein-bar", null)], "sweet");
  plan.wednesday.dinner = meal("Pasta e tonno di prova", [slot("zucchini", null), slot("pasta", 72), slot("tuna", 96)]);
  plan.thursday.lunch = meal("Pasta di prova: 64 g pasta e 46 g formaggio spalmabile", [
    slot("tomato", null, "Pomodori di prova"), slot("pasta", 64), slot("cream-cheese", 46),
  ]);
  plan.thursday.dinner = meal("Alternativa formaggio di prova", [
    slot("tomato", null, "Pomodori di prova"), slot("bread", 58),
    { id: "cheese", label: "Formaggio di prova", options: [{ ingredientId: "mozzarella", grams: 135 }, { ingredientId: "caciotta", grams: 92 }] },
  ]);
  plan.friday.lunch = meal("Alternativa pollame di prova", [
    slot("fennel", null), slot("bread", 58),
    { id: "poultry", label: "Pollame di prova", options: [{ ingredientId: "chicken", grams: 145 }, { ingredientId: "turkey", grams: 145 }] },
  ]);
  plan.friday.dinner = meal("Alternativa pesce di prova", [
    slot("lettuce", null), slot("bread", 58),
    { id: "fish", label: "Pesce di prova", options: [{ ingredientId: "white-fish", grams: 175 }, { ingredientId: "seafood-salad", grams: 225 }] },
  ]);
  plan.saturday.lunch = meal("Manzo di prova", [slot("zucchini", null), slot("bread", 58), slot("lean-beef", 155)]);
  plan.saturday.dinner = meal("Pasta e parmigiano di prova", [slot("tomato", null), slot("pasta", 64), slot("parmesan", 23)]);
  plan.sunday.lunch = meal("Fiocchi di latte di prova", [slot("tomato", null), slot("bread", 58), slot("cottage-cheese", 155)]);
  return plan;
}
