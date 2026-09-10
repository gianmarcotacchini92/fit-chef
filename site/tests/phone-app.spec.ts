import { expect, test } from "@playwright/test";
import { localStateSchema } from "../../src/lib/validation";

test.use({ serviceWorkers: "allow" });

test("phone app starts without a private diet, generates and retains recipes offline, and offers Google login", async ({ page, context }) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("/api/")) apiRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.getByText(/Nessuna dieta personale e inclusa nell.app pubblica/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 30_000 }).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Dal mio pasto", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Che pasto devi mangiare?" })).toBeVisible();
  await page.getByLabel("Pasto previsto dalla dieta", { exact: true }).fill("140 g pomodori\n85 gr pasta\n65 g Philadelphia");
  await page.getByRole("button", { name: "Usa questo pasto", exact: true }).click();
  await page.getByLabel(/^Confermo il formaggio spalmabile classico/).check();
  await page.getByRole("button", { name: "Conferma il pasto", exact: true }).click();
  await page.getByRole("button", { name: "Trasforma il mio pasto", exact: true }).click();
  await page.getByRole("dialog", { name: "Prima, rendiamolo un piatto interessante.", exact: true })
    .getByRole("button", { name: "Continua senza aggiunte", exact: true }).click();
  await expect(page.locator(".recipe-page")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Salva ricetta", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ricetta salvata", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accedi con Google", exact: true })).toBeEnabled({ timeout: 30_000 });
  await page.getByRole("button", { name: "Chiudi account", exact: true }).click();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!));
  const before = localStateSchema.parse(await stored());
  expect(before.weeklyDiet?.plan).toBeUndefined();
  expect(before.favoriteIds).toHaveLength(1);
  expect(before.recipes[0].ingredients.map((item) => [item.ingredientId, item.grams]).sort())
    .toEqual([["cream-cheese", 65], ["pasta", 85], ["tomato", 140]]);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".meal-base-item")).toHaveCount(3);
  expect(localStateSchema.parse(await stored()).favoriteIds).toEqual(before.favoriteIds);
  await page.getByRole("button", { name: "Trasforma il mio pasto", exact: true }).click();
  await page.getByRole("dialog", { name: "Prima, rendiamolo un piatto interessante.", exact: true })
    .getByRole("button", { name: "Continua senza aggiunte", exact: true }).click();
  await expect(page.locator(".recipe-page")).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => Date.parse(localStateSchema.parse(await stored()).recipes[0].createdAt))
    .toBeGreaterThan(Date.parse(before.recipes[0].createdAt));
  expect(localStateSchema.parse(await stored()).favoriteIds).toEqual(before.favoriteIds);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});
