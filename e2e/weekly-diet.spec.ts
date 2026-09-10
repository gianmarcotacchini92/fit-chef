import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_MEAL_INPUT } from "../src/lib/defaults";
import { initialWeeklyDietState } from "../src/lib/weekly-diet";
import { localStateSchema, weeklyPlanSchema } from "../src/lib/validation";
import { syntheticWeeklyPlan } from "../tests/fixtures/weekly-plan";
import { generateWithConfirmedExtras } from "./helpers/meal-generation";

async function start(page: Page, withPlan = true) {
  // Never read the developer's private migration file during a browser test.
  await page.route("**/api/weekly-diet", (route) => route.fulfill({ json: { plan: null } }));
  await page.addInitScript((workspace) => {
    if (!localStorage.getItem("fit-chef.workspace.v1")) {
      localStorage.setItem("fit-chef.workspace.v1", JSON.stringify(workspace));
    }
  }, {
    version: 1, input: structuredClone(DEFAULT_MEAL_INPUT), recipes: [], favoriteIds: [], cookedIds: [],
    weeklyDiet: { ...initialWeeklyDietState(), day: "thursday", ...(withPlan ? { plan: syntheticWeeklyPlan() } : {}) },
    builderMode: "weekly",
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "La tua dieta settimanale", exact: true })).toBeVisible();
}
async function approveSample(page: Page) {
  await page.getByLabel("Grammi Pomodori di prova", { exact: true }).fill("123");
  await page.getByLabel(/^Confermo prodotti, varianti, grammature/).check();
  await page.getByRole("button", { name: "Usa il pasto di giovedì", exact: true }).click();
  await expect(page.locator(".weekly-applied")).toBeVisible();
}

test("synthetic weekly meal preserves weights, generates a recipe and survives reload", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await expect(page.getByRole("button", { name: "Giovedì", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".weekly-original")).toContainText("64 g pasta");
  await expect(page.locator(".weekly-original")).toContainText("46 g formaggio spalmabile");
  await expect(page.getByLabel("Grammi Pomodori di prova", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Trasforma il mio pasto", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Usa il pasto di giovedì", exact: true }).click();
  await expect(page.locator(".weekly-diet .meal-errors")).toContainText("Pomodori di prova");
  await approveSample(page);
  await expect(page.getByLabel("Grammi del pasto Pasta di semola", { exact: true })).toHaveValue("64");
  await expect(page.getByLabel("Grammi del pasto Pasta di semola", { exact: true })).toHaveAttribute("readonly", "");
  await expect(page.locator(".meal-extra-check input:checked")).toHaveCount(0);
  await page.locator("#weekly-diet").screenshot({ path: testInfo.outputPath("weekly-synthetic.png") });
  await generateWithConfirmedExtras(page);
  await expect(page.locator(".recipe-page")).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("meal-extra-kcal")).toHaveText("0 kcal");
  await page.getByRole("button", { name: "Salva ricetta", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1") ?? "{}").recipes?.length)).toBe(1);
  const workspace = localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
  expect(workspace.weeklyDiet?.appliedKey).toBe("thursday-lunch");
  expect(workspace.recipes[0].ingredients).toHaveLength(3);
  expect(workspace.recipes[0].ingredients.find((item) => item.ingredientId === "pasta")?.grams).toBe(64);
  expect(workspace.recipes[0].ingredients.find((item) => item.ingredientId === "cream-cheese")?.grams).toBe(46);
  expect(workspace.favoriteIds).toHaveLength(1);
  await page.reload();
  await expect(page.locator(".weekly-applied")).toBeVisible();
  await expect(page.getByLabel("Grammi Pomodori di prova", { exact: true })).toHaveValue("123");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("synthetic alternatives require a choice and invalidate earlier confirmation", async ({ page }) => {
  await start(page);
  await page.getByRole("group", { name: "Pasto della dieta", exact: true }).getByRole("button", { name: "Cena", exact: true }).click();
  const choice = page.getByLabel("Scelta Formaggio di prova", { exact: true });
  await expect(choice).toHaveValue("");
  await page.getByLabel("Grammi Pomodori di prova", { exact: true }).fill("123");
  await page.getByLabel(/^Confermo prodotti, varianti, grammature/).check();
  await page.getByRole("button", { name: "Usa il pasto di giovedì", exact: true }).click();
  await expect(page.locator(".weekly-diet .meal-errors")).toContainText("scegli una delle alternative");
  await choice.selectOption("caciotta");
  await page.getByLabel(/^Confermo prodotti, varianti, grammature/).check();
  await page.getByRole("button", { name: "Usa il pasto di giovedì", exact: true }).click();
  await expect(page.locator(".weekly-applied")).toBeVisible();
  await expect(page.getByLabel(/^Grammi del pasto Caciotta/)).toHaveValue("92");
  await expect(page.getByLabel(/^Grammi del pasto Mozzarella/)).toHaveCount(0);
  await generateWithConfirmedExtras(page);
  await expect(page.locator(".recipe-page")).toBeVisible({ timeout: 60000 });
  await page.reload();
  await expect(choice).toHaveValue("caciotta");
  await choice.selectOption("mozzarella");
  await expect(page.locator(".weekly-applied")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Trasforma il mio pasto", exact: true })).toBeDisabled();
  await expect(page.getByLabel(/^Confermo prodotti, varianti, grammature/)).not.toBeChecked();
  await expect(page.locator(".weekly-fixed").last()).toContainText("135");
});

test("unweighed pieces stay unresolved, free choices clear stale meals, and all 28 cells remain accessible", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Martedì", exact: true }).click();
  await expect(page.getByLabel("Grammi Uova da pesare", { exact: true })).toHaveValue("");
  await expect(page.locator(".weekly-original")).toContainText("76 g piadina");
  await page.getByRole("button", { name: "Giovedì", exact: true }).click();
  await approveSample(page);
  await page.getByText("Guarda tutta la settimana", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Dieta settimanale completa" }).getByRole("button")).toHaveCount(28);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Apri Lunedì Pranzo", exact: true }).click();
  await expect(page.locator(".weekly-original")).toContainText("Scelta libera di prova");
  await expect(page.getByRole("button", { name: "Trasforma il mio pasto", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Componi questo pasto libero", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Che pasto devi mangiare?", exact: true })).toBeVisible();
  await expect(page.locator(".meal-base-item")).toHaveCount(0);
  await expect(page.getByLabel("Pasto previsto dalla dieta", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Dalla mia settimana", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lunedì", exact: true })).toHaveAttribute("aria-pressed", "true");
});

const measuredMeals = [
  {
    day: "Martedì", meal: "Colazione",
    quantities: [{ label: "Caffe di prova", grams: "41" }, { label: "Fetta di prova", grams: "18.3" }],
    choices: [], expected: { coffee: 41, bread: 63, "cooked-ham": 38, "cheese-slice": 18.3 },
  },
  {
    day: "Martedì", meal: "Pranzo",
    quantities: [{ label: "Insalata di prova", grams: "119" }, { label: "Uova da pesare", grams: "94.3" }],
    choices: [], expected: { lettuce: 119, "plain-wrap": 76, eggs: 94.3 },
  },
  {
    day: "Mercoledì", meal: "Pranzo",
    quantities: [{ label: "Zucchine di prova", grams: "143" }],
    choices: [], expected: { zucchini: 143, "brown-rice": 68, "smoked-salmon": 82 }, setTime: true,
  },
  {
    day: "Martedì", meal: "Spuntino",
    quantities: [{ label: "Frutta di prova", grams: "127" }],
    choices: [{ label: "Frutta di prova", value: "banana" }], expected: { banana: 127, whey: 24 },
  },
  {
    day: "Lunedì", meal: "Colazione",
    quantities: [{ label: "Caffe di prova", grams: "41" }, { label: "Polvere di prova", grams: "22.5" }],
    choices: [], expected: { coffee: 41, whey: 22.5 },
  },
] satisfies Array<{
  day: string; meal: string; setTime?: boolean;
  quantities: { label: string; grams: string }[];
  choices: { label: string; value: string }[];
  expected: Record<string, number>;
}>;

for (const fixture of measuredMeals) {
  test(`synthetic measured meal: ${fixture.day} ${fixture.meal}`, async ({ page }) => {
    await start(page);
    await page.getByRole("button", { name: fixture.day, exact: true }).click();
    await page.getByRole("group", { name: "Pasto della dieta", exact: true }).getByRole("button", { name: fixture.meal, exact: true }).click();
    for (const choice of fixture.choices) await page.getByLabel(`Scelta ${choice.label}`, { exact: true }).selectOption(choice.value);
    for (const quantity of fixture.quantities) await page.getByLabel(`Grammi ${quantity.label}`, { exact: true }).fill(quantity.grams);
    if (fixture.setTime) {
      await expect(page.locator(".weekly-time-note")).toContainText("35 minuti");
      await page.getByRole("button", { name: "Imposta 55 minuti per questo pasto", exact: true }).click();
    }
    await page.getByLabel(/^Confermo prodotti, varianti, grammature/).check();
    await page.getByRole("button", { name: `Usa il pasto di ${fixture.day.toLowerCase()}`, exact: true }).click();
    await expect(page.locator(".weekly-applied")).toBeVisible();
    await generateWithConfirmedExtras(page);
    await expect(page.locator(".recipe-page, .error-notice")).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".error-notice")).toHaveCount(0);
    await expect(page.getByTestId("meal-extra-kcal")).toHaveText("0 kcal");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1") ?? "{}").recipes?.length)).toBe(1);
    const state = localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
    expect(Object.fromEntries(state.recipes[0].ingredients.map((item) => [item.ingredientId, item.grams]))).toEqual(fixture.expected);
    expect(state.recipes[0].input.targets.kcal).toBeNull();
  });
}

test("empty public workspace can import and export a private plan without inventing defaults", async ({ page }) => {
  await start(page, false);
  await expect(page.getByText("Benvenuto: il tuo piano resta personale.", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Giorno della dieta" })).toHaveCount(0);
  const upload = page.getByLabel("Importa piano privato JSON", { exact: true });
  await upload.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(page.locator(".weekly-diet [role=alert]")).toContainText("Piano non valido");
  await upload.setInputFiles({ name: "plan.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(syntheticWeeklyPlan())) });
  await expect(page.locator(".weekly-original")).toContainText("64 g pasta");
  await page.getByText("Importa o esporta il piano privato", { exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Esporta piano privato JSON", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("fit-chef-piano-privato.json");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(weeklyPlanSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")))).toEqual(syntheticWeeklyPlan());
  await page.reload();
  await expect(page.locator(".weekly-original")).toContainText("64 g pasta");
});

test("replacing a private plan asks confirmation, clears drafts and retains the rest of the workspace", async ({ page }) => {
  await start(page);
  await approveSample(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1") ?? "{}").weeklyDiet?.appliedKey)).toBe("thursday-lunch");
  const before = localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
  const replacement = syntheticWeeklyPlan();
  replacement.thursday.lunch.slots[1].options[0].grams = 66;
  replacement.thursday.lunch.original = "Piano sostitutivo di prova";
  await page.getByText("Importa o esporta il piano privato", { exact: true }).click();
  const upload = page.getByLabel("Importa piano privato JSON", { exact: true });
  const file = { name: "replacement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(replacement)) };
  page.once("dialog", (dialog) => dialog.dismiss());
  await upload.setInputFiles(file);
  await expect(page.locator(".weekly-applied")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await upload.setInputFiles(file);
  await expect(page.locator(".weekly-original")).toContainText("Piano sostitutivo");
  await expect(page.locator(".weekly-applied")).toHaveCount(0);
  await expect(page.getByLabel("Grammi Pomodori di prova", { exact: true })).toHaveValue("");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1") ?? "{}").weeklyDiet?.drafts)).toEqual({});
  const after = localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
  expect(after.weeklyDiet?.appliedKey).toBeUndefined();
  expect(after.input.preferences).toEqual(before.input.preferences);
  expect(after.recipes).toEqual(before.recipes);
  expect(after.favoriteIds).toEqual(before.favoriteIds);
});
