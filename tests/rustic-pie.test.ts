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

test("real phrases keep suffix counts, singular portions and decimal measured weights", () => {
  assert.equal(detectRusticPie("una porzione di torta rustica")?.slices, 1);
  assert.equal(detectRusticPie("torta rustica alla ricotta, 2 fette")?.slices, 2);
  assert.equal(detectRusticPie("200,5 g di torta rustica")?.knownGrams, 200.5);
  assert.equal(detectRusticPie("torta rustica")?.slices, 0);
  assert.equal(detectRusticPie("-2 fette di torta rustica")?.slices, -2);
  assert.equal(detectRusticPie("-200 g torta rustica")?.knownGrams, -200);
  assert.equal(detectRusticPie("1.5 fette di torta rustica")?.slices, 1.5);
});

test("measured mass needs no slice count; invalid runtime values never throw or escape the range", () => {
  const cfg = { slices: 0, size: "medium" as const, base: "puff" as const, filling: "ricotta" as const, knownGrams: 200, pastrySharePercent: 40 };
  assert.equal(estimateRusticPie(cfg)?.centralGrams, 200);
  for (const bad of [NaN, Infinity, -1, 0, 5001]) assert.equal(estimateRusticPie({ ...cfg, knownGrams: bad }), null);
  // Simulate untrusted persisted/runtime input.
  assert.equal(estimateRusticPie({ ...cfg, size: "invalid" as typeof cfg.size }), null);
  for (const share of [20, 70, NaN, Infinity]) assert.equal(estimateRusticPie({ ...cfg, pastrySharePercent: share }), null);
  for (const share of [25, 40, 55]) {
    const e = estimateRusticPie({ ...cfg, pastrySharePercent: share })!;
    const center = Math.round(e.food.per100g.kcal * 2);
    assert.ok(center >= e.lowKcal && center <= e.highKcal);
  }
});
