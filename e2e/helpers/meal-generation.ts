import { expect, type Page } from "@playwright/test";
import { getChefExtraProposal } from "../../src/lib/meal";
import { localStateSchema } from "../../src/lib/validation";

export async function generateWithConfirmedExtras(page: Page) {
  const state = localStateSchema.parse(await page.evaluate(() => JSON.parse(localStorage.getItem("fit-chef.workspace.v1")!)));
  const reviewExpected = !state.input.pantry.some((item) => item.mode === "preferred") && Boolean(getChefExtraProposal(state.input));
  await page.getByRole("button", { name: "Trasforma il mio pasto", exact: true }).click();
  if (reviewExpected) {
    const dialog = page.getByRole("dialog", { name: "Prima, rendiamolo un piatto interessante.", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Continua senza aggiunte", exact: true }).click();
  }
}
