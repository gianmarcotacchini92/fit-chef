import { expect, test } from "@playwright/test";

test("generates a calculated recipe, saves it, and restores favorites after reload", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const configuration = page.waitForResponse((response) => response.url().endsWith("/api/config"));
  await page.goto("/");
  expect((await configuration).status()).toBe(200);
  await page.getByRole("button", { name: "Dal frigo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cosa hai in frigo?" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
  await page.getByRole("button", { name: "Crea la mia ricetta FIT", exact: true }).click();
  await expect(page.locator(".recipe-page, .error-notice")).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".error-notice")).toHaveCount(0);
  await expect(page.locator(".recipe-page")).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".nutrition-strip .nutrient")).toHaveCount(5);
  await expect(page.locator(".recipe-ingredient")).not.toHaveCount(0);
  await page.getByRole("tab", { name: "Macros", exact: true }).click();
  await expect(page.getByRole("heading", { name: "I numeri, senza sorprese" })).toBeVisible();
  await expect(page.locator(".macro-table tbody tr")).toHaveCount(5);
  await page.getByRole("tab", { name: "Preparazione", exact: true }).click();
  await expect(page.locator(".recipe-step")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Completa passaggio 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Completa passaggio 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Salva ricetta", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ricetta salvata", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("recipe.png"), fullPage: true });
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: /Le mie ricette/ }).click();
  await expect(page.locator(".library-card")).toHaveCount(1);
  await page.locator(".library-title").click();
  await expect(page.getByRole("button", { name: "Ricetta salvata", exact: true })).toBeVisible();
  const firstTitle = await page.locator(".recipe-intro h1").textContent();
  await page.getByRole("button", { name: "Fammi un'altra", exact: true }).click();
  await expect(page.locator(".recipe-intro h1")).not.toHaveText(firstTitle ?? "", { timeout: 60000 });
  await expect(page.getByRole("button", { name: "Salva ricetta", exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a sweet breakfast example generates a real sweet recipe", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await page.getByRole("button", { name: "Dal frigo", exact: true }).click();
  await page.getByRole("button", { name: /E se fosse una colazione/ }).click();
  await expect(page.getByLabel(/Quantita disponibile .*avena/i)).toBeVisible();
  await page.getByRole("button", { name: "Crea la mia ricetta FIT", exact: true }).click();
  await expect(page.locator(".recipe-page, .error-notice")).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".error-notice")).toHaveCount(0);
  await expect(page.locator(".recipe-page")).toBeVisible();
  await expect(page.locator(".recipe-intro h1")).not.toBeEmpty();
});

test("rejects incompatible fixed diet instead of inventing nutrition", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dal frigo", exact: true }).click();
  await page.getByLabel("Uso nella dieta Petto di pollo", { exact: true }).selectOption("fixed");
  await page.getByLabel("Grammi dieta Petto di pollo", { exact: true }).fill("150");
  await page.getByLabel("Calorie target", { exact: true }).fill("100");
  await page.getByLabel("Calorie come massimo obbligatorio", { exact: true }).check();
  await page.getByRole("button", { name: "Crea la mia ricetta FIT", exact: true }).click();
  await expect(page.locator(".error-notice")).toBeVisible({ timeout: 60000 });
  await expect(page.locator(".error-notice")).toContainText(/calor|kcal|grammatur/i);
  await expect(page.locator(".recipe-page")).toHaveCount(0);
});

test("catalog, explicit diet import, and empty library are usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dal frigo", exact: true }).click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Account e copia cloud" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Account e copia cloud" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeFocused();
  await page.getByRole("navigation").getByRole("button", { name: /Le mie ricette/ }).click();
  await expect(page.getByRole("heading", { name: "Il tuo ricettario aspetta il primo amore." })).toBeVisible();
  await page.getByRole("button", { name: "Crea una ricetta", exact: true }).last().click();
  await page.getByLabel("Cerca ingredienti").fill("avena");
  await expect(page.locator(".catalog-item")).toHaveCount(1);
  await page.locator(".catalog-item").click();
  await expect(page.getByLabel(/Quantita disponibile .*avena/i)).toBeVisible();
  await page.locator(".diet-import summary").click();
  await page.getByLabel("Alimenti della dieta", { exact: true }).fill("verdure libere");
  await page.getByRole("button", { name: "Importa e blocca grammature" }).click();
  await expect(page.locator(".form-error").first()).toContainText("grammi");
});
