import { expect, test } from "@playwright/test";
import { localStateSchema } from "../../src/lib/validation";
import { DEFAULT_MEAL_INPUT } from "../../src/lib/defaults";
import { initialWeeklyDietState } from "../../src/lib/weekly-diet";
import { syntheticWeeklyPlan } from "../../tests/fixtures/weekly-plan";

test.use({ serviceWorkers: "allow" });

test("phone diary preserves the private weekly plan, logs without paid APIs and works offline", async ({ page, context }) => {
  const plan = syntheticWeeklyPlan();
  plan.monday.lunch = {
    original: "Pranzo sintetico", taste: "savory",
    slots: [
      { id: "pasta", label: "Pasta di prova", options: [{ ingredientId: "pasta", grams: 85 }] },
      { id: "tomato", label: "Pomodori di prova", options: [{ ingredientId: "tomato", grams: 140 }] },
    ],
  };
  await page.addInitScript((state) => {
    if (!localStorage.getItem("fit-chef.workspace.v1")) localStorage.setItem("fit-chef.workspace.v1", JSON.stringify(state));
  }, {
    version: 1, input: structuredClone(DEFAULT_MEAL_INPUT), recipes: [], favoriteIds: [], cookedIds: [],
    weeklyDiet: { ...initialWeeklyDietState(), plan },
  });
  const apiCalls: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("/api/")) apiCalls.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Il tuo diario alimentare", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 30_000 }).toBe(true);
  await page.getByRole("button", { name: "La mia dieta", exact: true }).click();
  await page.getByLabel(/^Confermo alimenti, alternative/).check();
  await page.getByRole("button", { name: "Registra il pasto del piano", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Registrate 2 voci" })).toBeVisible();
  const read = async () => localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
  const before = await read();
  expect(before.nutrition?.entries).toHaveLength(2);
  expect(before.nutrition?.targets).toBeUndefined();
  expect(before.weeklyDiet?.plan).toEqual(plan);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accedi con Google", exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Chiudi account", exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  expect((await read()).nutrition?.entries).toEqual(before.nutrition?.entries);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Il tuo diario alimentare", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "La mia dieta", exact: true }).click();
  const duplicateConfirmation = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.message()).toContain("Registrarli di nuovo");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Registra il pasto del piano", exact: true }).click();
  await duplicateConfirmation;
  expect((await read()).nutrition?.entries).toHaveLength(2);
  await page.reload();
  await page.getByLabel("Data del diario", { exact: true }).fill("2026-10-09");
  await page.getByRole("button", { name: "La mia dieta", exact: true }).click();
  await page.getByRole("button", { name: "Registra il pasto del piano", exact: true }).click();
  await expect.poll(async () => (await read()).nutrition?.entries.length).toBe(4);
  expect((await read()).nutrition?.entries.filter((entry) => entry.date === "2026-10-09")).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});
