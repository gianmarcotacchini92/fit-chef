import { expect, test } from "@playwright/test";
import { DEFAULT_MEAL_INPUT } from "../../src/lib/defaults";
import { emptyNutritionState } from "../../src/lib/nutrition-state";

test("diary meal summaries stay compact and expose food macros and editing on expansion", async ({ page }) => {
  const food = {
    id: "test-rice", name: "Riso test", state: "secco", source: "Valori di test",
    per100g: { kcal: 350, protein: 7, carbs: 78, fat: 1, fiber: 1 },
  };
  const entry = {
    id: "test-diary-entry", date: "2026-10-29", meal: "lunch",
    food, grams: 100, createdAt: "2026-10-29T12:00:00.000Z",
  };
  const state = {
    version: 1, input: structuredClone(DEFAULT_MEAL_INPUT), recipes: [], favoriteIds: [], cookedIds: [],
    nutrition: { ...emptyNutritionState(), entries: [entry] },
  };
  await page.addInitScript((seed) => {
    localStorage.setItem("fit-chef.workspace.v1", JSON.stringify(seed));
  }, state);
  await page.goto("./");
  await page.getByLabel("Data del diario", { exact: true }).fill("2026-10-29");
  const lunch = page.locator("details.nf-meal-card").filter({ has: page.getByText("Pranzo", { exact: true }) });
  await expect(lunch).toHaveCount(1);
  await expect(lunch).not.toHaveAttribute("open", "");
  await expect(lunch.locator("summary")).toContainText("350 kcal");
  await expect(lunch.locator("summary")).toContainText("P 7");
  await expect(lunch.getByText("Riso test")).toBeHidden();
  await lunch.locator("summary").click();
  await expect(lunch.getByText("Riso test")).toBeVisible();
  await expect(lunch.getByText(/350 kcal - P 7 g - C 78 g - G 1 g/)).toBeVisible();
  await lunch.getByLabel("Grammi per Riso test").fill("150");
  await lunch.getByLabel("Grammi per Riso test").press("Enter");
  await expect(lunch.locator("summary")).toContainText("525 kcal");
  await lunch.getByRole("button", { name: /Aggiungi a Pranzo/ }).click();
  await expect(page.locator("details.nf-composer-card")).toHaveAttribute("open", "");
  await expect(page.getByLabel("Pasto di destinazione")).toHaveValue("lunch");
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).resolves.toBe(true);
});
