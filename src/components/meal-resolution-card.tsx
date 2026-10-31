"use client";
import { useEffect, useRef, useState } from "react";
import { INGREDIENTS } from "@/lib/catalog";
import { mealCandidates, normalizeMealName, type MealResolution } from "@/lib/meal-understanding";
import { searchMealProducts } from "@/lib/meal-product-search";
import type { FoodSnapshot } from "@/lib/nutrition-diary";

export function MealResolutionCard({ initial, savedFoods, onPreview, onInvalidate, onSave }: {
  initial: MealResolution; savedFoods: FoodSnapshot[];
  onPreview: (food: FoodSnapshot, grams: number, note: string) => void;
  onInvalidate: () => void; onSave: (food: FoodSnapshot) => boolean;
}) {
  const [query, setQuery] = useState(initial.query);
  const [food, setFood] = useState(initial.food);
  const [grams, setGrams] = useState(initial.grams === null ? "" : String(initial.grams));
  const [online, setOnline] = useState<FoodSnapshot[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [remember, setRemember] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const local = mealCandidates(query, savedFoods);
  const choices = [...local, ...online.filter(f => !local.some(l => l.id === f.id))];
  const amount = Number(grams.replace(",", "."));
  const valid = food !== null && grams.trim() !== "" && Number.isFinite(amount) && amount > 0 && amount <= 5000 && !initial.quantity.invalid;
  const catalogPortion = food ? INGREDIENTS.find(i => i.id === food.id)?.defaultGrams : undefined;

  async function search() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage(""); setOnline([]);
    try {
      const result = await searchMealProducts(query, { signal: controller.signal });
      if (request.current !== controller || controller.signal.aborted) return;
      setOnline(result.foods); setMessage(result.message);
    } catch (error) {
      if (request.current === controller && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Ricerca non disponibile.");
    } finally { if (request.current === controller) setBusy(false); }
  }
  function confirm() {
    if (!valid || !food) return;
    if (remember) {
      const aliases = [...new Set([...(food.mealAliases ?? []), normalizeMealName(initial.query)])].filter(Boolean).slice(-20);
      const saved = { ...food, mealAliases: aliases };
      if (!onSave(saved)) { setMessage("Impossibile salvare l'associazione. La voce non è stata confermata."); return; }
    }
    onPreview(food, amount, `Alimento confermato: ${food.state}. ${initial.quantity.grams === null ? "Peso confermato dall'utente." : "Peso dichiarato nel testo."}`);
    setMessage("Voce pronta nell'anteprima del pasto.");
  }
  return <section className="nf-food-row" aria-label={`Risolvi ${initial.original}`}>
    <h3>{initial.original}</h3>
    {initial.quantity.invalid && <p role="alert">Quantità non valida. Correggi la frase del pasto e interpreta di nuovo.</p>}
    {!food ? <>
      <p className="nf-muted">{choices.length ? "Conferma quale alimento intendi. I valori vengono dalla voce scelta, non dal nome del piatto." : "Non ho una corrispondenza sicura. Puoi cercare il prodotto per nome senza compilare calorie e macro."}</p>
      <label className="nf-field">Nome da cercare
        <input value={query} maxLength={100} onChange={e => {request.current?.abort(); request.current = null; setBusy(false); setQuery(e.target.value); setOnline([]); setMessage(""); onInvalidate();}}/>
      </label>
      <button type="button" className="nf-text-button" disabled={busy || query.trim().length < 3} onClick={search}>{busy ? "Cerco…" : "Cerca prodotto online"}</button>
      <p className="nf-muted">La ricerca invia solo questo nome a Open Food Facts. I prodotti confezionati non sostituiscono una ricetta fatta in casa.</p>
      {choices.map(candidate => <button type="button" className="nf-text-button" key={candidate.id} onClick={() => {setFood(candidate); setMessage(""); onInvalidate();}}>
        {candidate.name} · {candidate.state}
      </button>)}
    </> : <>
      <strong>{food.name}</strong><p className="nf-muted">{food.state}</p>
      <details><summary>Valori e fonte</summary><p>{food.per100g.kcal} kcal per 100 g · P {food.per100g.protein} · C {food.per100g.carbs} · G {food.per100g.fat}</p><p>{food.source}</p></details>
      <button type="button" className="nf-text-button" onClick={() => {setFood(null); setMessage(""); onInvalidate();}}>Cambia alimento</button>
      <label className="nf-field">{initial.quantity.grams === null ? `Quanto ne hai mangiato? Grammi totali${initial.quantity.label ? ` per ${initial.quantity.label}` : ""}` : "Peso totale, g"}
        <input type="number" min="0.1" max="5000" step="0.1" value={grams} onChange={e => {setGrams(e.target.value); setMessage(""); onInvalidate();}}/>
      </label>
      {initial.quantity.grams === null && catalogPortion && <button type="button" className="nf-text-button" onClick={() => {setGrams(String(catalogPortion)); onInvalidate();}}>
        Usa porzione indicativa del catalogo: {catalogPortion} g ({food.state})
      </button>}
      {initial.quantity.grams === null && <p className="nf-muted">Pezzi e millilitri non vengono trasformati in grammi senza conferma. Il peso è quello totale, nello stato indicato sopra.</p>}
      <label className="nf-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/>Ricorda questo alimento quando scrivo «{initial.query}» (confermo che corrisponde)</label>
      <button type="button" className="nf-button" disabled={!valid} onClick={confirm}>Conferma alimento e quantità</button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
