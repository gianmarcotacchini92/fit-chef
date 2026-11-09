"use client";

import { useState } from "react";
import { weeklyShoppingList } from "@/lib/shopping-list";
import type { FoodSnapshot } from "@/lib/nutrition-diary";
import type { WeeklyDietState } from "@/lib/types";

const formatGrams = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

export function ShoppingList({ state, savedFoods, openPlan }: {
  state: WeeklyDietState;
  savedFoods: FoodSnapshot[];
  openPlan: () => void;
}) {
  const [checked, setChecked] = useState<Record<string, number>>({});
  const { items, incomplete } = weeklyShoppingList(state, savedFoods);

  return <section className="nf-card nf-shopping">
    <div className="nf-section-heading">
      <div><h2>Da comprare</h2><p className="nf-muted">Quantità totali del piano di 7 giorni. I pasti liberi sono fuori lista.</p></div>
      <button type="button" className="nf-text-button" onClick={openPlan}>Apri il piano</button>
    </div>
    {!state.plan && <p>Carica un piano settimanale per ottenere la lista della spesa.</p>}
    {incomplete.length > 0 && <details className="nf-alert">
      <summary>Lista parziale · {incomplete.length} voci da completare nel piano</summary>
      <ul>{incomplete.map(({ meal, reason }, index) => <li key={index}><strong>{meal}</strong> · {reason}</li>)}</ul>
    </details>}
    {items.length > 0 && <ul className="nf-shopping-items">
      {items.map(({ id, name, grams }) => <li key={id}>
        <label>
          <input type="checkbox" checked={checked[id] === grams} onChange={(event) => {
            const purchased = event.target.checked;
            setChecked((current) => ({ ...current, [id]: purchased ? grams : 0 }));
          }}/>
          <span>{name}</span>
          <strong>{formatGrams.format(grams)} g</strong>
        </label>
      </li>)}
    </ul>}
    {state.plan && items.length === 0 && <p>Il piano non contiene ancora alimenti con quantità utilizzabili.</p>}
  </section>;
}
