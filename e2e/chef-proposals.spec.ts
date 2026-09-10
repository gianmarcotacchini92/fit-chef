import { expect, test, type Page } from "@playwright/test";
import { localStateSchema } from "../src/lib/validation";

async function enterPoultryMeal(page: Page) {
  await page.route("**/api/weekly-diet", (route) => route.fulfill({ json: { plan: null } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Dal mio pasto", exact: true }).click();
  await page.getByLabel("Pasto previsto dalla dieta", { exact: true }).fill("165 g pollo\n175 g finocchi\n62 g pane");
  await page.getByRole("button", { name: "Usa questo pasto", exact: true }).click();
  await expect(page.locator(".meal-base-item")).toHaveCount(3);
}

async function savedRecipe(page: Page) {
  await expect(page.locator(".recipe-page")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!).recipes.length)).toBeGreaterThan(0);
  return localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!))).recipes[0];
}

test("chef proposes a transformation before generation and adds extras only after explicit approval", async ({ page }) => {
  let requests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/generations") requests++;
  });
  await enterPoultryMeal(page);
  await expect(page.locator(".chef-proposal-card")).toContainText("Pane croccante");
  await expect(page.locator(".meal-extra-check input:checked")).toHaveCount(0);
  await page.getByRole("button", { name: "Trasforma il mio pasto", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Prima, rendiamolo un piatto interessante.", exact: true });
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText("kcal per porzione");
  expect(requests).toBe(0);
  await prompt.getByRole("button", { name: "Ho questi extra, usali", exact: true }).click();
  const recipe = await savedRecipe(page);
  expect(requests).toBe(1);
  expect(recipe.ingredients.find((item) => item.ingredientId === "chicken")?.grams).toBe(165);
  expect(recipe.ingredients.find((item) => item.ingredientId === "fennel")?.grams).toBe(175);
  expect(recipe.ingredients.find((item) => item.ingredientId === "bread")?.grams).toBe(62);
  expect(recipe.ingredients.filter((item) => !["chicken", "fennel", "bread"].includes(item.ingredientId)).length).toBeGreaterThan(0);
  await expect(page.getByTestId("meal-extra-kcal")).not.toHaveText("0 kcal");
  expect(recipe.title).not.toMatch(/bocconcini.*finocchi.*pane/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("declining the chef proposal leaves every extra unconfirmed", async ({ page }) => {
  await enterPoultryMeal(page);
  await page.getByRole("button", { name: "Trasforma il mio pasto", exact: true }).click();
  await page.getByRole("dialog", { name: "Prima, rendiamolo un piatto interessante.", exact: true })
    .getByRole("button", { name: "Continua senza aggiunte", exact: true }).click();
  const recipe = await savedRecipe(page);
  expect(recipe.ingredients.map((item) => item.ingredientId).sort()).toEqual(["bread", "chicken", "fennel"]);
  expect(recipe.input.pantry.some((item) => item.mode === "preferred")).toBe(false);
  await expect(page.getByTestId("meal-extra-kcal")).toHaveText("0 kcal");
});

test("partial availability returns to individual selection without authorizing the whole proposal", async ({ page }) => {
  await enterPoultryMeal(page);
  await page.getByRole("button", { name: "Trasforma il mio pasto", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Prima, rendiamolo un piatto interessante.", exact: true });
  await prompt.getByRole("button", { name: "Scelgo solo gli extra che ho", exact: true }).click();
  await expect(prompt).not.toBeVisible();
  await expect(page.locator(".meal-extra-check input:checked")).toHaveCount(0);
  await page.getByLabel("Ho Paprika", { exact: true }).check();
  await page.getByRole("button", { name: "Trasforma il mio pasto", exact: true }).click();
  const recipe = await savedRecipe(page);
  expect(recipe.ingredients.every((item) => ["chicken", "fennel", "bread", "paprika"].includes(item.ingredientId))).toBe(true);
  expect(recipe.ingredients.find((item) => item.ingredientId === "paprika")?.grams).toBeGreaterThan(0);
});
