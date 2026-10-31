import { expect, test } from "@playwright/test";
test("static diary resolves missing quantities without contacting a nonexistent AI backend", async ({ page }) => {
  const aiRequests: string[] = [];
  page.on("request", request => { if (/\/api\/(config|meal-language)/.test(request.url())) aiRequests.push(request.url()); });
  await page.goto("./");
  const input = page.getByRole("region", { name: "Descrivi il pasto" });
  await input.getByLabel("Descrizione del pasto").fill("due uova e 0,15 kg pollo");
  await input.getByRole("button", { name: "Interpreta il pasto" }).click();
  await expect(input.getByLabel(/^Usa AI per capire il testo/)).toHaveCount(0);
  await input.getByRole("button", { name: /Usa porzione indicativa del catalogo/ }).click();
  await input.getByRole("button", { name: "Conferma alimento e quantità" }).click();
  await expect(input.getByRole("button", { name: "Conferma e registra 2 alimenti" })).toBeEnabled();
  expect(aiRequests).toEqual([]);
});
