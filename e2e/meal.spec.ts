import { expect, test, type Page } from "@playwright/test";
import { localStateSchema } from "../src/lib/validation";
import { generateWithConfirmedExtras } from "./helpers/meal-generation";

async function enterMeal(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Dal mio pasto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Che pasto devi mangiare?" })).toBeVisible();
  await page.getByLabel("Pasto previsto dalla dieta", { exact: true }).fill("150 g macinato magro di manzo e 200 g zucchine");
  await page.getByRole("button", { name: "Usa questo pasto", exact: true }).click();
  await expect(page.locator(".meal-base-item")).toHaveCount(2);
  await expect(page.locator(".meal-extra-check input:checked")).toHaveCount(0);
}

async function transformMeal(page: Page) {
  await generateWithConfirmedExtras(page);
  await expect(page.locator(".recipe-page, .error-notice")).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".error-notice")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Il tuo pasto, con le aggiunte in chiaro" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem("fit-chef.workspace.v1");
    return raw ? JSON.parse(raw).recipes.length : 0;
  })).toBeGreaterThan(0);
  const state = localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
  const recipe = state.recipes[0];
  expect(recipe.ingredients.find((item) => item.ingredientId === "lean-beef")?.grams).toBe(150);
  expect(recipe.ingredients.find((item) => item.ingredientId === "zucchini")?.grams).toBe(200);
  expect(recipe.input.targets.kcal).toBeNull();
  return recipe;
}

test("meal first: confirmed breadcrumbs transform beef and vegetables without changing the diet", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await enterMeal(page);
  await page.getByLabel(/^Ho Pangrattato/i).check();
  await page.getByLabel(/^Ho Olio extravergine/i).check();
  await page.screenshot({ path: testInfo.outputPath("meal-input.png"), fullPage: true });
  const recipe = await transformMeal(page);
  const bread = recipe.ingredients.find((item) => item.ingredientId === "breadcrumbs");
  expect(bread?.grams).toBeGreaterThan(0);
  expect(bread!.grams).toBeLessThanOrEqual(15);
  expect(recipe.ingredients.every((item) => ["lean-beef", "zucchini", "breadcrumbs", "olive-oil"].includes(item.ingredientId))).toBe(true);
  const baseKcal = recipe.ingredients.filter((item) => ["lean-beef", "zucchini"].includes(item.ingredientId)).reduce((sum, item) => sum + item.nutrients.kcal, 0);
  const extrasKcal = recipe.ingredients.filter((item) => !["lean-beef", "zucchini"].includes(item.ingredientId)).reduce((sum, item) => sum + item.nutrients.kcal, 0);
  expect(baseKcal + extrasKcal).toBeCloseTo(recipe.nutritionTotal.kcal, 4);
  expect(extrasKcal).toBeGreaterThan(0);
  await expect(page.getByTestId("meal-extra-kcal")).toHaveText(`${Math.round(extrasKcal)} kcal`);
  await page.screenshot({ path: testInfo.outputPath("meal-result.png"), fullPage: true });
  await page.getByRole("button", { name: "Salva ricetta", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel(/^Ho Pangrattato/i)).toBeChecked();
  await page.getByRole("navigation").getByRole("button", { name: /Le mie ricette/ }).click();
  await page.locator(".library-title").click();
  await expect(page.getByTestId("meal-extra-kcal")).toHaveText(`${Math.round(extrasKcal)} kcal`);
  expect(errors).toEqual([]);
});

test("no confirmation means no additional ingredients and zero extra calories", async ({ page }) => {
  await enterMeal(page);
  const recipe = await transformMeal(page);
  expect(recipe.ingredients.map((item) => item.ingredientId).sort()).toEqual(["lean-beef", "zucchini"]);
  await expect(page.getByTestId("meal-extra-kcal")).toHaveText("0 kcal");
  await expect(page.getByText("Nessuna aggiunta utilizzata.", { exact: true })).toBeVisible();
});

test("flour is used only when confirmed and replaces neither the beef nor vegetables", async ({ page }) => {
  await enterMeal(page);
  await page.getByLabel(/^Ho Farina/i).check();
  await page.getByLabel(/^Ho Olio extravergine/i).check();
  await page.getByLabel(/^Ho Succo di limone/i).check();
  const recipe = await transformMeal(page);
  expect(recipe.ingredients.find((item) => item.ingredientId === "wheat-flour")?.grams).toBeGreaterThan(0);
  expect(recipe.ingredients.find((item) => item.ingredientId === "wheat-flour")!.grams).toBeLessThanOrEqual(10);
  expect(recipe.ingredients.every((item) => ["lean-beef", "zucchini", "wheat-flour", "olive-oil", "lemon"].includes(item.ingredientId))).toBe(true);
});
