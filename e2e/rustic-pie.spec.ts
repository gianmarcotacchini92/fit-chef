import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/weekly-diet", route => route.fulfill({ json: { plan: null } }));
  await page.goto("/");
});

test("mixed meals retain every item and field changes invalidate previews", async ({ page }) => {
  const input = page.getByRole("region", { name: "Descrivi il pasto" });
  await input.getByLabel("Descrizione del pasto").fill("2 fette di torta rustica e 150 g pollo");
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  await input.getByLabel("Quale base?").selectOption("puff");
  await input.getByLabel(/^Confermo: nella stima/).check();
  await input.getByRole("button", { name: /Usa questa stima/ }).click();
  await expect(input.getByRole("button", { name: "Conferma e registra 2 alimenti" })).toBeEnabled();
  await input.getByLabel("Numero di fette").fill("3");
  await expect(input.getByRole("button", { name: /Conferma e registra/ })).toBeDisabled();
  await input.getByRole("button", { name: /Usa questa stima/ }).click();
  await input.getByRole("button", { name: "Conferma e registra 2 alimenti" }).click();
  const entries = await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!).nutrition.entries);
  expect(entries.map((e: {grams: number}) => e.grams).sort((a: number,b: number) => a-b)).toEqual([150,330]);
});

test("saved reuse uses current fields, persists metadata and cannot clear unresolved foods", async ({ page }) => {
  const input = page.getByRole("region", { name: "Descrivi il pasto" });
  const describe = async (text: string) => {
    await input.getByLabel("Descrizione del pasto").fill(text);
    await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  };
  await describe("2 fette di torta rustica");
  await input.getByLabel("Quale base?").selectOption("puff");
  await input.getByLabel(/^Confermo: nella stima/).check();
  await input.getByRole("button", { name: "Salva come mio piatto" }).click();
  await page.reload();
  await describe("2 fette di torta rustica + 100 g alimento inesistente");
  await input.getByLabel("Numero di fette").fill("3");
  await input.getByLabel(/^Confermo stessi ingredienti/).check();
  await input.getByRole("button", { name: /Usa La mia torta.*330 g/ }).click();
  await expect(input.getByRole("button", { name: /Conferma e registra/ })).toBeDisabled();
  await expect(input.getByRole("region", { name: "Risolvi 100 g alimento inesistente" })).toBeVisible();
  await describe("2 fette di torta rustica");
  await input.getByLabel(/Peso totale se conosciuto/).fill("180");
  await input.getByLabel(/^Confermo stessi ingredienti/).check();
  await input.getByRole("button", { name: /Usa La mia torta.*180 g/ }).click();
  await expect(input.getByRole("spinbutton", { name: /^Grammi per/ })).toHaveValue("180");
  await describe("200 g La mia torta rustica alla ricotta");
  await expect(input.getByRole("region", { name: "Stima guidata torta rustica" })).toHaveCount(0);
  await expect(input.getByRole("spinbutton", { name: /^Grammi per/ })).toHaveValue("200");
});

test("known weight needs no slices and manual weight edits clear obsolete interval notes", async ({ page }) => {
  const input = page.getByRole("region", { name: "Descrivi il pasto" });
  await input.getByLabel("Descrizione del pasto").fill("200,5 g di torta rustica");
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  await input.getByLabel("Quale base?").selectOption("puff");
  await input.getByLabel(/^Confermo: nella stima/).check();
  await input.getByRole("button", { name: /Usa questa stima/ }).click();
  await expect(input.getByRole("spinbutton", { name: /^Grammi per/ })).toHaveValue("200.5");
  await input.getByRole("spinbutton", { name: /^Grammi per/ }).fill("180");
  await expect(input.locator(".nf-smart-meal-result")).not.toContainText("Scenario");
  await input.getByLabel("Descrizione del pasto").fill("150 g pollo");
  await expect(input.getByRole("button", { name: /Conferma e registra/ })).toHaveCount(0);
});

test("every guide field invalidates the preview and failed saves never report success", async ({ page }) => {
  const input = page.getByRole("region", { name: "Descrivi il pasto" });
  await input.getByLabel("Descrizione del pasto").fill("2 fette di torta rustica");
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  await input.getByLabel("Quale base?").selectOption("puff");
  await input.getByLabel(/^Confermo: nella stima/).check();
  const preview = input.getByRole("button", { name: /Usa questa stima/ });
  await preview.click();
  await input.getByLabel("Dimensione delle fette").selectOption("large");
  await expect(input.getByRole("button", { name: /Conferma e registra/ })).toHaveCount(0);
  await preview.click();
  await input.getByLabel(/Ipotesi: percentuale/).fill("45");
  await expect(input.getByRole("button", { name: /Conferma e registra/ })).toHaveCount(0);
  await preview.click();
  await input.getByLabel(/^Confermo: nella stima/).uncheck();
  await expect(input.getByRole("button", { name: /Conferma e registra/ })).toHaveCount(0);
  await input.getByLabel(/^Confermo: nella stima/).check();
  await preview.click();
  await input.getByLabel("Quale base?").selectOption("shortcrust");
  await expect(input.getByRole("button", { name: /Conferma e registra/ })).toHaveCount(0);
  await input.getByLabel("Quale base?").selectOption("puff");
  await input.getByRole("button", { name: "Salva come mio piatto" }).click();
  await page.evaluate(() => {
    const key = "fit-chef.workspace.v1";
    const state = JSON.parse(localStorage.getItem(key)!);
    const food = state.nutrition.savedFoods[0];
    state.nutrition.savedFoods = Array.from({ length: 500 }, (_, i) => ({ ...food, id: `manual-${i}` }));
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await input.getByLabel("Descrizione del pasto").fill("200 g torta rustica");
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  await input.getByLabel("Quale base?").selectOption("puff");
  await input.getByLabel(/^Confermo: nella stima/).check();
  await input.getByRole("button", { name: "Salva come mio piatto" }).click();
  await expect(input.getByRole("status").filter({ hasText: "Salvataggio non riuscito" })).toBeVisible();
  await expect(input.getByRole("button", { name: "Piatto salvato", exact: true })).toHaveCount(0);
});
