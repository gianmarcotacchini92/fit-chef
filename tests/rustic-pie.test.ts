import assert from "node:assert/strict";
import test from "node:test";
import { detectRusticPie, estimateRusticPie, RUSTIC_INGREDIENTS } from "../src/lib/rustic-pie";

test("Italian rustic pie text detects slice count, size and ricotta filling", () => {
  const a = detectRusticPie("Ho mangiato 2 fette medie di torta rustica con ripieno di ricotta");
  assert.equal(a?.slices, 2);
  assert.equal(a?.size, "medium");
  assert.equal(a?.filling, "ricotta");
  assert.equal(detectRusticPie("150 g di pollo"), null);
  assert.equal(detectRusticPie("una fetta piccola di torta salata alla ricotta")?.slices, 1);
});

test("rustic pie never claims nutrition for unknown base/filling", () => {
  const config = { slices: 2, size: "medium" as const, knownGrams: null, pastrySharePercent: 40 };
  assert.equal(estimateRusticPie({ ...config, base: "unknown", filling: "ricotta" }), null);
  assert.equal(estimateRusticPie({ ...config, base: "shortcrust", filling: "ricotta" }), null);
  assert.equal(estimateRusticPie({ ...config, base: "puff", filling: "unknown" }), null);
});

test("ranges transparently combine sourced densities with separately labelled assumptions", () => {
  const output = estimateRusticPie({ slices: 2, size: "medium", base: "puff", filling: "ricotta", knownGrams: null, pastrySharePercent: 40 });
  assert.ok(output);
  assert.deepEqual([output.gramsLow,output.gramsHigh,output.centralGrams], [140,300,220]);
  assert.ok(output.lowKcal < output.highKcal);
  assert.match(output.food.source, /SCENARI EDITORIALI/);
  assert.match(output.food.source, /USDA/);
  assert.equal(RUSTIC_INGREDIENTS.ricotta.kcal,174);
  assert.equal(RUSTIC_INGREDIENTS.pastry.kcal,558);
  assert.equal(output.food.per100g.kcal, 327.6);
});

test("measured weight narrows only mass uncertainty, not composition uncertainty", () => {
  const output = estimateRusticPie({ slices: 2, size: "medium", base: "puff", filling: "ricotta", knownGrams: 210, pastrySharePercent: 40 });
  assert.equal(output?.gramsLow,210);
  assert.equal(output?.gramsHigh,210);
  assert.equal(output?.centralGrams,210);
});

test("out-of-range parameters do not produce diary values", () => {
  const cfg = { slices: 2, size: "medium" as const, base: "puff" as const, filling: "ricotta" as const, pastrySharePercent: 40 };
  assert.equal(estimateRusticPie({ ...cfg, knownGrams: -5 }),null);
  assert.equal(estimateRusticPie({ ...cfg, knownGrams: null, slices: 0 }),null);
  assert.equal(estimateRusticPie({ ...cfg, knownGrams: null, pastrySharePercent: 95 }),null);
});
