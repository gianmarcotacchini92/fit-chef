import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { initialWeeklyDietState } from "../src/lib/weekly-diet";
import { localStateSchema } from "../src/lib/validation";
import { syntheticWeeklyPlan } from "../tests/fixtures/weekly-plan";
import { generateWithConfirmedExtras } from "./helpers/meal-generation";

async function start(page: Page, protein: string, maxTime = DEFAULT_MEAL_INPUT.preferences.maxTime) {
  const input = structuredClone(DEFAULT_MEAL_INPUT);
  input.preferences.maxTime = maxTime;
  const plan = syntheticWeeklyPlan();
  plan.monday.dinner = {
    original: "Pasto di pesce di prova",
    taste: "savory",
    slots: [
      { id: "lettuce", label: "Lattuga di prova", options: [{ ingredientId: "lettuce", grams: 125 }] },
      { id: "bread", label: "Pane di prova", options: [{ ingredientId: "bread", grams: 64 }] },
      { id: "fish", label: "Pesce di prova", options: [{ ingredientId: protein, grams: protein === "white-fish" ? 185 : 230 }] },
    ],
  };
  await page.route("**/api/weekly-diet", (route) => route.fulfill({ json: { plan: null } }));
  await page.addInitScript((state) => {
    if (!localStorage.getItem("fit-chef.workspace.v1")) localStorage.setItem("fit-chef.workspace.v1", JSON.stringify(state));
  }, {
    version: 1, input, recipes: [], favoriteIds: [], cookedIds: [],
    builderMode: "weekly", weeklyDiet: { ...initialWeeklyDietState(), plan, day: "monday", meal: "dinner" },
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
}

test("another clearly explains when the time limit leaves only one preparation", async ({ page }) => {
  await start(page, "seafood-salad", 10);
  await confirmMeal(page);
  await generateWithConfirmedExtras(page);
  await expect(page.locator(".recipe-page")).toBeVisible();
  const previous = localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!))).recipes[0];
  await page.getByRole("button", { name: "Fammi un'altra", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "una sola preparazione verificata" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!).recipes[0]?.createdAt))
    .not.toBe(previous.createdAt);
  const state = localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
  expect(state.recipes).toHaveLength(1);
  expect(state.recipes[0].id).toBe(previous.id);
  expect(state.recipes[0].ingredients).toEqual(previous.ingredients);
  expect(state.input.preferences.maxTime).toBe(10);
});

async function confirmMeal(page: Page) {
  await page.getByRole("button", { name: "Lunedì", exact: true }).click();
  await page.getByRole("group", { name: "Pasto della dieta", exact: true }).getByRole("button", { name: "Cena", exact: true }).click();
  if (!await page.locator(".weekly-applied").isVisible()) {
    await page.getByLabel(/^Confermo prodotti, varianti, grammature/).check();
    await page.getByRole("button", { name: "Usa il pasto di lunedì", exact: true }).click();
  }
  await expect(page.locator(".weekly-applied")).toBeVisible();
}

for (const protein of ["white-fish", "seafood-salad"]) {
  for (const action of ["same meal", "another"]) {
    test(`${protein}: ${action} rotates after all recipes have been seen, including a reload`, async ({ page }) => {
      await start(page, protein);
      const templates: string[] = [];
      let previousId: string | undefined;
      for (let index = 0; index < 6; index++) {
        if (index === 0 || action === "same meal" || index === 3) {
          if (index === 3) await page.reload();
          else if (index > 0) await page.getByRole("button", { name: "Torna al tuo pasto", exact: true }).click();
          await confirmMeal(page);
          await generateWithConfirmedExtras(page);
        } else {
          await page.getByRole("button", { name: "Fammi un'altra", exact: true }).click();
        }
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!).recipes[0]?.id), { timeout: 60_000 })
          .not.toBe(previousId);
        await expect(page.locator(".recipe-page")).toBeVisible();
        const state = localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
        const recipe = state.recipes[0];
        expect(recipe.templateId).not.toBe(templates.at(-1));
        expect(recipe.ingredients.find((item) => item.ingredientId === protein)?.grams).toBe(protein === "white-fish" ? 185 : 230);
        expect(recipe.ingredients.find((item) => item.ingredientId === "lettuce")?.grams).toBe(125);
        expect(recipe.ingredients.find((item) => item.ingredientId === "bread")?.grams).toBe(64);
        expect(recipe.ingredients).toHaveLength(3);
        templates.push(recipe.templateId);
        previousId = recipe.id;
      }
      expect(new Set(templates.slice(0, 3)).size).toBe(3);
      expect(new Set(templates.slice(3)).size).toBe(3);
    });
  }
}
