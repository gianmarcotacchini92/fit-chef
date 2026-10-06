import { expect, test } from "@playwright/test";
import { DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { localStateSchema } from "../src/lib/validation";
import { initialWeeklyDietState } from "../src/lib/weekly-diet";
import { syntheticWeeklyPlan } from "../tests/fixtures/weekly-plan";
import { catalogFood } from "../src/lib/nutrition-diary";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/weekly-diet", (route) => route.fulfill({ json: { plan: null } }));
});

test("the new home has no assumed body data and preserves the old private plan when logging", async ({ page }) => {
  const plan = syntheticWeeklyPlan();
  plan.monday.lunch = {
    original: "Pasto sintetico di prova", taste: "savory",
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
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Il tuo diario alimentare", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Imposta profilo e obiettivi" })).toBeVisible();
  await page.getByRole("button", { name: "La mia dieta", exact: true }).click();
  await page.getByLabel(/^Confermo alimenti, alternative/).check();
  await page.getByRole("button", { name: "Registra il pasto del piano", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Registrate 2 voci" })).toBeVisible();
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!));
  const before = localStateSchema.parse(await stored());
  expect(before.nutrition?.profile).toBeUndefined();
  expect(before.nutrition?.targets).toBeUndefined();
  expect(before.nutrition?.entries.map((entry) => [entry.food.id, entry.grams])).toEqual([
    [catalogFood("pasta").id, 85], [catalogFood("tomato").id, 140],
  ]);
  expect(before.weeklyDiet?.plan).toEqual(plan);
  await page.reload();
  expect(localStateSchema.parse(await stored()).nutrition?.entries).toEqual(before.nutrition?.entries);
  await expect(page.getByRole("heading", { name: "Il tuo diario alimentare", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("invalid stored data is preserved and editing remains disabled instead of silently resetting", async ({ page }) => {
  const corrupt = '{"version":1,"nutrition":{"entries":"broken"}}';
  await page.addInitScript((raw) => localStorage.setItem("fit-chef.workspace.v1", raw), corrupt);
  await page.goto("/");
  await expect(page.getByRole("alert").filter({ hasText: "Non saranno sovrascritti" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Imposta profilo e obiettivi" })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("fit-chef.workspace.v1"))).toBe(corrupt);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accedi con Google", exact: true })).toBeDisabled();
});

test("TDEE proposals require confirmation and preserve independently edited macros", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Profilo e TDEE", exact: true }).click();
  await expect(page.getByLabel("Eta (anni)", { exact: true })).toHaveValue("");
  await page.getByLabel("Eta (anni)", { exact: true }).fill("34");
  await page.getByLabel(/^Sesso biologico/).selectOption("male");
  await page.getByLabel("Altezza (cm)", { exact: true }).fill("180");
  await page.getByLabel("Peso (kg)", { exact: true }).fill("80");
  await page.getByLabel(/^Livello di attivita/).selectOption("1.55");
  await page.getByLabel(/^Obiettivo/).selectOption("cut");
  await expect(page.getByLabel(/^Aggiustamento calorico/)).toHaveValue("-10");
  await page.getByLabel(/^Obiettivo/).selectOption("maintain");
  await expect(page.getByLabel(/^Aggiustamento calorico/)).toHaveValue("0");
  await page.getByRole("button", { name: "Calcola stima TDEE e proposta", exact: true }).click();
  await expect(page.getByText("BMR stimato: 1760 kcal/die (mifflin)", { exact: true })).toBeVisible();
  await expect(page.getByText("TDEE stimato: 2728 kcal/die", { exact: true })).toBeVisible();
  const stored = async () => localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
  expect((await stored()).nutrition?.profile).toBeUndefined();
  await page.getByLabel("Calorie (kcal)", { exact: true }).fill("2000");
  await page.getByLabel("Proteine (g)", { exact: true }).fill("145");
  await page.getByLabel("Carboidrati (g)", { exact: true }).fill("260");
  await page.getByLabel("Grassi (g)", { exact: true }).fill("65");
  await page.getByRole("button", { name: "Conferma profilo e target", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profilo e obiettivi confermati" })).toBeVisible();
  expect((await stored()).nutrition?.targets).toEqual({ kcal: 2000, protein: 145, carbs: 260, fat: 65 });
  expect((await stored()).nutrition?.checkIns).toHaveLength(1);
  await page.reload();
  expect((await stored()).nutrition?.targets?.kcal).toBe(2000);
  await page.getByRole("button", { name: "Profilo e TDEE", exact: true }).click();
  await expect(page.getByLabel("Peso (kg)", { exact: true })).toHaveValue("80");
});

test("manual foods, quantity edits and saved meals retain exact nutrient snapshots", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Il tuo diario alimentare", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Manuale", exact: true }).click();
  for (const [label, value] of [
    ["Nome", "Yogurt di prova"], ["Stato", "pronto"], ["Kcal per 100 g", "100"],
    ["Proteine per 100 g (g)", "10"], ["Carboidrati per 100 g (g)", "12"],
    ["Grassi per 100 g (g)", "2"], ["Fibre per 100 g (g)", "1"], ["Grammi da registrare", "150"],
  ]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Aggiungi alla selezione", exact: true }).click();
  const prompt = page.waitForEvent("dialog").then((dialog) => dialog.accept("Pasto di prova"));
  await page.getByRole("button", { name: "Salva come pasto", exact: true }).click();
  await prompt;
  await page.getByRole("button", { name: "Registra nel diario", exact: true }).click();
  await expect(page.getByText("150 kcal consumate", { exact: true })).toBeVisible();
  const stored = async () => localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
  const first = (await stored()).nutrition!.entries[0];
  expect(first.grams).toBe(150);
  expect(first.food.per100g).toEqual({ kcal: 100, protein: 10, carbs: 12, fat: 2, fiber: 1 });
  await page.getByLabel(/^Grammi per Yogurt di prova/).fill("200");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await stored()).nutrition?.entries[0].grams).toBe(200);
  await expect(page.getByText("200 kcal consumate", { exact: true })).toBeVisible();
  expect((await stored()).nutrition?.savedMeals[0].items[0].grams).toBe(150);
  await page.getByLabel("Data del diario", { exact: true }).fill("2026-10-09");
  await page.getByRole("tab", { name: "Pasti salvati", exact: true }).click();
  await page.locator(".nf-food-row").filter({ hasText: "Pasto di prova" }).getByRole("button", { name: "Aggiungi a Pranzo", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pasto \"Pasto di prova\" aggiunto a Pranzo" })).toBeVisible();
  await expect(page.getByText("150 kcal consumate", { exact: true })).toBeVisible();
  const second = (await stored()).nutrition!.entries.find((entry) => entry.date === "2026-10-09")!;
  expect(second.id).not.toBe(first.id);
  expect(second.food).toEqual(first.food);
  const remove = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await page.locator(".nf-food-row").filter({ hasText: "Yogurt di prova - pronto" }).getByRole("button", { name: "Elimina", exact: true }).click();
  await remove;
  await expect(page.getByText("0 kcal consumate", { exact: true })).toBeVisible();
  expect((await stored()).nutrition?.entries).toHaveLength(1);
});
