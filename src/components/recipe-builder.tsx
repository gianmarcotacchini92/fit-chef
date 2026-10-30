"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { INGREDIENTS } from "@/lib/catalog";
import { foodSnapshotSchema, type FoodSnapshot } from "@/lib/nutrition-diary";
import type { Nutrients } from "@/lib/types";

type RecipeLine = { key: string; foodId: string; grams: string };
const EMPTY: Nutrients = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

/** A personal recipe becomes a reusable per-100-g food. Its ingredients remain user-entered,
 * and the cooked yield is mandatory so cooking-water loss is not guessed. */
export function recipeFood(input: {
  name: string; ingredients: Array<{ food: FoodSnapshot; grams: number }>;
  yieldGrams: number;
}): FoodSnapshot {
  if (!input.name.trim()) throw new Error("Dai un nome alla ricetta.");
  if (!Number.isFinite(input.yieldGrams) || input.yieldGrams <= 0 || input.yieldGrams > 100_000)
    throw new Error("Indica il peso finale effettivo della preparazione in grammi.");
  if (!input.ingredients.length || input.ingredients.length > 60)
    throw new Error("Inserisci da 1 a 60 ingredienti.");
  const totals = { ...EMPTY };
  for (const item of input.ingredients) {
    if (!Number.isFinite(item.grams) || item.grams <= 0 || item.grams > 5000)
      throw new Error("Ogni ingrediente richiede un peso valido.");
    for (const nutrient of ["kcal", "protein", "carbs", "fat", "fiber"] as const) {
      totals[nutrient] += item.food.per100g[nutrient] * item.grams / 100;
    }
  }
  const per100g = Object.fromEntries(Object.entries(totals).map(([key, value]) =>
    [key, Math.round(value * 10000 / input.yieldGrams) / 100])) as Nutrients;
  const food = {
    id: `recipe-${crypto.randomUUID()}`, name: input.name.trim(),
    state: "ricetta casalinga pronta, peso finale misurato",
    source: "Ricetta personale: nutrienti stimati dalla somma degli ingredienti inseriti e divisi per il peso finale indicato. Verifica ricette e prodotti; la cottura può modificare alcuni valori.",
    per100g,
  };
  return foodSnapshotSchema.parse(food);
}

export function RecipeBuilder({ savedFoods, onSave }: {
  savedFoods: FoodSnapshot[];
  onSave: (food: FoodSnapshot) => void;
}) {
  const [name, setName] = useState("");
  const [lines, setLines] = useState<RecipeLine[]>([{ key: "first", foodId: "", grams: "" }]);
  const [yieldGrams, setYieldGrams] = useState("");
  const [message, setMessage] = useState("");
  const foods = useMemo(() => [
    ...INGREDIENTS.map(item => ({
      id: item.id, name: item.name, state: item.state, source: item.source, per100g: item.nutrients,
    })),
    ...savedFoods,
  ], [savedFoods]);
  const chosen = lines.map(line => ({ ...line, food: foods.find(food => food.id === line.foodId) }));
  const estimated = chosen.reduce((result, line) => {
    if (!line.food || !line.grams.trim()) return result;
    const grams = Number(line.grams);
    if (!Number.isFinite(grams) || grams <= 0) return result;
    for (const k of ["kcal", "protein", "carbs", "fat", "fiber"] as const)
      result[k] += grams * line.food.per100g[k] / 100;
    return result;
  }, { ...EMPTY });

  function save() {
    try {
      if (chosen.some(item => !item.food || !item.grams.trim())) throw new Error("Seleziona alimento e peso per ogni ingrediente.");
      const food = recipeFood({
        name, yieldGrams: Number(yieldGrams),
        ingredients: chosen.map(item => ({ food: item.food!, grams: Number(item.grams) })),
      });
      onSave(food);
      setName(""); setYieldGrams("");
      setLines([{ key: crypto.randomUUID(), foodId: "", grams: "" }]);
      setMessage("Ricetta inviata agli alimenti personali. Potrai registrarla dal diario in grammi; lo storico non viene alterato.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Ricetta non valida."); }
  }
  return <section className="nf-food-row" aria-label="Crea ricetta personale">
    <h3>Crea una ricetta personale</h3>
    <p className="nf-muted">Per esempio i tuoi pancake: inserisci farina, uova, latte e gli altri ingredienti realmente utilizzati. Pesa il totale dei pancake pronti; le kcal totali non cambiano per l'evaporazione dell'acqua, ma quelle per 100 g sì.</p>
    <label className="nf-field">Nome ricetta<input value={name} maxLength={160} placeholder="Pancake fatti in casa" onChange={event => setName(event.target.value)}/></label>
    {chosen.map(line => <div className="nf-food-row" key={line.key}>
      <label className="nf-field">Ingrediente
        <select value={line.foodId} onChange={event => setLines(old => old.map(row => row.key === line.key ? { ...row, foodId: event.target.value } : row))}>
          <option value="">Seleziona un alimento</option>
          {foods.map(food => <option key={food.id} value={food.id}>{food.name} — {food.state}</option>)}
        </select>
      </label>
      <label className="nf-field">Grammi ingrediente<input type="number" min="0.1" max="5000" step="0.1" value={line.grams} onChange={event => setLines(old => old.map(row => row.key === line.key ? { ...row, grams: event.target.value } : row))}/></label>
      <button type="button" className="nf-text-button" disabled={lines.length === 1} onClick={() => setLines(old => old.filter(row => row.key !== line.key))}><Trash2 size={16}/>Rimuovi</button>
    </div>)}
    <button type="button" className="nf-text-button" disabled={lines.length >= 60} onClick={() => setLines(old => [...old, { key: crypto.randomUUID(), foodId: "", grams: "" }])}><Plus size={16}/>Aggiungi ingrediente</button>
    <p>Stima totale impasto/ricetta: {Math.round(estimated.kcal)} kcal · P {estimated.protein.toFixed(1)} g · C {estimated.carbs.toFixed(1)} g · G {estimated.fat.toFixed(1)} g</p>
    <label className="nf-field">Peso totale del prodotto finito (g)<input type="number" min="0.1" max="100000" step="0.1" value={yieldGrams} onChange={event => setYieldGrams(event.target.value)} placeholder="Pesa tutti i pancake pronti"/></label>
    <button type="button" className="nf-button" onClick={save}><Plus size={16}/>Salva ricetta negli alimenti personali</button>
    {message && <p role="status" className="nf-alert">{message}</p>}
  </section>;
}
