import { expect, test } from "@playwright/test";
const product = { code: "12345678", product_name: "Ravioli demo", brands: "Marca demo", nutrition_data_per: "100g", nutriments: {
  "energy-kcal_100g": 250, proteins_100g: 10, carbohydrates_100g: 40, fat_100g: 5, fiber_100g: 2,
} };
test.beforeEach(async ({ page }) => {
  await page.route("**/api/weekly-diet", route => route.fulfill({ json: { plan: null } }));
  await page.route("**/api/config", route => route.fulfill({ json: { aiTextAvailable: false } }));
});
test("known food asks only for weight, without manual nutrients", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("region", { name: "Descrivi il pasto" });
  await input.getByLabel("Descrizione del pasto").fill("due uova e 150 g pollo");
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  await expect(input.getByRole("button", { name: /Conferma e registra/ })).toBeDisabled();
  await input.getByRole("button", { name: /Usa porzione indicativa del catalogo/ }).click();
  await input.getByRole("button", { name: "Conferma alimento e quantità" }).click();
  await expect(input.getByRole("button", { name: "Conferma e registra 2 alimenti" })).toBeEnabled();
});
test("unknown product search fills nutrition and a remembered name survives reload", async ({ page }) => {
  await page.route("**/cgi/search.pl?*", route => route.fulfill({ json: { products: [product] } }));
  await page.goto("/");
  const input = page.getByRole("region", { name: "Descrivi il pasto" });
  await input.getByLabel("Descrizione del pasto").fill("180 g ravioli marca demo");
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  await input.getByRole("button", { name: "Cerca prodotto online" }).click();
  await input.getByRole("button", { name: /Ravioli demo · Marca demo/ }).click();
  await expect(input.getByLabel("Peso totale, g")).toHaveValue("180");
  await input.getByLabel(/^Ricorda questo alimento/).check();
  await input.getByRole("button", { name: "Conferma alimento e quantità" }).click();
  await page.reload();
  await input.getByLabel("Descrizione del pasto").fill("90 g ravioli marca demo");
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  await expect(input.getByRole("spinbutton", { name: /^Grammi per/ })).toHaveValue("90");
  await expect(input.getByRole("button", { name: "Cerca prodotto online" })).toHaveCount(0);
});
test("AI is opt in and late responses cannot restore a changed meal", async ({ page }) => {
  await page.route("**/api/config", route => route.fulfill({ json: { aiTextAvailable: true } }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let called = false;
  await page.route("**/api/meal-language", async route => { called = true; await gate; await route.fulfill({ json: { segments: [{ text: "due uova", kind: "food", query: "uova" }] } }).catch(() => undefined); });
  await page.goto("/");
  const input = page.getByRole("region", { name: "Descrivi il pasto" });
  await input.getByLabel("Descrizione del pasto").fill("due uova");
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  expect(called).toBe(false);
  await input.getByLabel(/^Usa AI per capire il testo/).check();
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  await expect.poll(() => called).toBe(true);
  await input.getByLabel("Descrizione del pasto").fill("150 g pollo");
  release();
  await expect(input.getByRole("region", { name: /Risolvi/ })).toHaveCount(0);
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  // Returned text is intentionally stale: validator rejects it and local fallback keeps pollo.
  await expect(input.getByRole("spinbutton", { name: /^Grammi per/ })).toHaveValue("150");
});

test("AI segmentation handles a sentence without list separators and keeps both foods", async ({ page }) => {
  await page.route("**/api/config", route => route.fulfill({ json: { aiTextAvailable: true } }));
  await page.route("**/api/meal-language", route => route.fulfill({ json: { segments: [
    { text: "Oggi ho mangiato ", kind: "context", query: "" },
    { text: "una mela", kind: "food", query: "mela" },
    { text: " poi ", kind: "context", query: "" },
    { text: "due uova", kind: "food", query: "uova" },
  ] } }));
  await page.goto("/");
  const input = page.getByRole("region", { name: "Descrivi il pasto" });
  await input.getByLabel("Descrizione del pasto").fill("Oggi ho mangiato una mela poi due uova");
  await input.getByLabel(/^Usa AI per capire il testo/).check();
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  await expect(input.getByRole("region", { name: /Risolvi/ })).toHaveCount(2);
  await expect(input.getByRole("region", { name: "Risolvi una mela" })).toBeVisible();
  await expect(input.getByRole("region", { name: "Risolvi due uova" })).toBeVisible();
});
