"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, ChefHat, Flame, Info, LockKeyhole, Plus, Sparkles, X } from "lucide-react";
import { INGREDIENTS, getIngredient } from "@/lib/catalog";
import { confirmChefExtras, confirmMealExtra, createMealBase, getChefExtraProposal, getMealExtraSuggestions, ingredientRestriction, mealBaseNutrition } from "@/lib/meal";
import { formatNumber, parseMealText, type ParsedMealItem } from "@/lib/pantry";
import type { PantryItem, RecipeInput } from "@/lib/types";
import { ChefExtraProposal } from "./chef-extra-proposal";

type Props = {
  input: RecipeInput;
  onChange: (input: RecipeInput | ((current: RecipeInput) => RecipeInput)) => void;
  onPendingChange: (pending: boolean) => void;
  initialText?: string;
  lockedBase?: boolean;
};

export function MealComposer({ input, onChange, onPendingChange, initialText = "", lockedBase = false }: Props) {
  const [text, setText] = useState(initialText);
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedGrams, setSelectedGrams] = useState("150");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{ item: ParsedMealItem; grams: string }[] | null>(null);
  const [genericAccepted, setGenericAccepted] = useState(false);
  const base = input.pantry.filter((item) => item.mode === "fixed");
  const extras = input.pantry.filter((item) => item.mode === "preferred");
  const unconfirmed = input.pantry.filter((item) => item.mode === "available");
  const suggestions = getMealExtraSuggestions(input.pantry, input.preferences.taste);
  const proposal = getChefExtraProposal(input);
  const baseline = mealBaseNutrition(input.pantry);
  const servings = input.preferences.servings;
  const pending = text.trim().length > 0 || review !== null || selectedId !== "" || Object.keys(drafts).length > 0;

  useEffect(() => {
    onPendingChange(pending);
  }, [onPendingChange, pending]);

  function clearDraft(id: string) {
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function replaceMeal(items: { ingredientId: string; grams: number }[], example = false) {
    if (input.pantry.length > 0 && !window.confirm("Sostituire gli alimenti del pasto? Le aggiunte dovranno essere riconfermate. Storico e ricette salvate rimangono invariati.")) return;
    try {
      const pantry = createMealBase(items, servings);
      onChange((current) => ({
        ...current,
        pantry,
        preferences: example ? { ...current.preferences, taste: "savory", meal: "lunch" } : current.preferences,
      }));
      setText("");
      setDrafts({});
      setSelectedId("");
      setErrors([]);
      setReview(null);
      setGenericAccepted(false);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Impossibile confermare il pasto."]);
    }
  }

  function parseMeal() {
    const result = parseMealText(text, INGREDIENTS);
    setReview(null);
    setGenericAccepted(false);
    setErrors(result.errors);
    if (result.errors.length) {
      return;
    }
    if (result.items.some((item) => item.grams === null || item.notice)) {
      setReview(result.items.map((item) => ({ item, grams: item.grams === null ? "" : String(item.grams) })));
      return;
    }
    const quantities = result.items.flatMap((item) => item.grams === null ? [] : [{ ingredientId: item.ingredientId, grams: item.grams }]);
    replaceMeal(quantities);
  }

  function confirmParsedMeal() {
    if (!review) {
      setErrors(["Rileggi il pasto prima di confermare."]);
      return;
    }
    const missing = review.filter((row) => {
      const grams = Number(row.grams.replace(",", "."));
      return !row.grams.trim() || !Number.isFinite(grams) || grams <= 0 || grams > 5000;
    });
    const errors = missing.map(({ item }) => `${getIngredient(item.ingredientId)?.name ?? item.inputName}: indica i grammi per porzione, maggiori di zero e non superiori a 5000.`);
    if (review.some(({ item }) => item.notice) && !genericAccepted) errors.push("Conferma l'uso della voce nutrizionale generica oppure modifica il prodotto nel testo.");
    if (errors.length) {
      setErrors(errors);
      return;
    }
    replaceMeal(review.map(({ item, grams }) => ({ ingredientId: item.ingredientId, grams: Number(grams.replace(",", ".")) })));
  }

  function addBase() {
    try {
      if (!selectedId) throw new Error("Seleziona prima un alimento.");
      const pantry = createMealBase([
        ...base.map((item) => ({ ingredientId: item.ingredientId, grams: item.dietGrams! })),
        { ingredientId: selectedId, grams: Number(selectedGrams.replace(",", ".")) },
      ], servings);
      onChange((current) => ({ ...current, pantry: [...pantry, ...current.pantry.filter((item) => item.mode !== "fixed" && item.ingredientId !== selectedId)] }));
      clearDraft(selectedId);
      setSelectedId("");
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Quantita non valida."]);
    }
  }

  function changeBase(item: PantryItem, raw: string) {
    const grams = Number(raw);
    if (!raw || !Number.isFinite(grams) || grams <= 0 || grams > 5000 || !Number.isInteger(servings) || servings < 1 || servings > 8) {
      setDrafts((current) => ({ ...current, [item.ingredientId]: raw }));
      setErrors(["Completa le quantita del pasto con valori maggiori di zero e imposta da 1 a 8 porzioni."]);
      return;
    }
    onChange((current) => ({ ...current, pantry: current.pantry.map((entry) => entry.ingredientId === item.ingredientId
      ? { ...entry, mode: "fixed", dietGrams: grams, availableGrams: grams * servings } : entry) }));
    clearDraft(item.ingredientId);
    setErrors([]);
  }

  function toggleExtra(id: string, grams: number, confirmed: boolean) {
    try {
      const pantry = confirmMealExtra(input.pantry, id, grams, servings, confirmed);
      onChange((current) => ({ ...current, pantry }));
      clearDraft(id);
      setErrors([]);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "Conferma la quantita dell'aggiunta."]);
    }
  }

  function changeExtra(id: string, raw: string, max: number) {
    const grams = Number(raw);
    if (!raw || !Number.isFinite(grams) || grams <= 0 || grams > max) {
      setDrafts((current) => ({ ...current, [id]: raw }));
      setErrors([`Per questa aggiunta indica una quantita maggiore di zero e non superiore a ${max} g per porzione.`]);
      return;
    }
    toggleExtra(id, grams, true);
  }

  return (
    <section className="card meal-composer" id="meal-builder">
      <div className="section-heading">
        <div className="heading-with-step">
          <span className="section-step">01</span>
          <div><h2>{lockedBase ? "Il pasto e pronto per il tuo chef" : "Che pasto devi mangiare?"}</h2><p>{lockedBase ? "Base confermata dal piano settimanale. Gli extra li scegli tu." : "Scrivi gli alimenti della dieta. Li trasformiamo, non li sostituiamo."}</p></div>
        </div>
        <ChefHat size={24} className="section-icon"/>
      </div>

      {!lockedBase && <><label className="meal-input-label" htmlFor="meal-text">IL PASTO DI PARTENZA, CON I GRAMMI PER PORZIONE</label>
      <textarea id="meal-text" aria-label="Pasto previsto dalla dieta" className="meal-textarea" rows={3}
        placeholder={"Pomodori\n90 gr pasta\n80 gr formaggio spalmabile"}
        value={text} onChange={(event) => { setText(event.target.value); setReview(null); setGenericAccepted(false); setErrors([]); }}/>
      <div className="meal-input-actions">
        <button className="button button-primary" onClick={parseMeal} disabled={!text.trim()}>Usa questo pasto <ArrowRight size={15}/></button>
        {text && <button className="text-button" onClick={() => { setText(""); setErrors([]); setReview(null); setGenericAccepted(false); }}>Annulla testo</button>}
        <button className="meal-example-button" onClick={() => replaceMeal([
          { ingredientId: "lean-beef", grams: 150 }, { ingredientId: "zucchini", grams: 200 },
        ], true)}>Prova manzo e zucchine</button>
      </div>
      <p className="micro-copy">Puoi usare g, gr o grammi, prima o dopo l&apos;alimento. Se non scrivi un peso, te lo chiediamo senza inventarlo. Riso e pasta sono pesati secchi; le verdure mondate.</p>

      {review && <section className="meal-review" aria-labelledby="meal-review-title">
        <div className="meal-review-heading"><Check size={18}/><div><h3 id="meal-review-title">Ho riconosciuto il tuo pasto</h3><p>Le quantita gia scritte sono conservate. Completa solo quelle mancanti e conferma la voce del catalogo.</p></div></div>
        {review.map(({ item, grams }, index) => {
          const food = getIngredient(item.ingredientId)!;
          return <div className="meal-review-row" key={item.ingredientId}>
            <span className="ingredient-emoji">{food.emoji}</span>
            <div className="meal-review-name"><strong>{food.name}</strong><span>{food.state}</span>{item.grams === null && <small>Peso da indicare, non stimato automaticamente</small>}</div>
            <label className="meal-review-quantity"><input aria-label={`Grammi da confermare ${food.name}`} type="number" min=".1" max="5000" step=".1" placeholder="Grammi" value={grams} required
              onChange={(event) => { setReview((current) => current?.map((row, rowIndex) => rowIndex === index ? { ...row, grams: event.target.value } : row) ?? null); setErrors([]); }}/><span>g / porz.</span></label>
          </div>;
        })}
        {review.filter(({ item }) => item.notice).map(({ item }) => <p key={item.ingredientId} className="meal-review-notice">{item.notice}</p>)}
        {review.some(({ item }) => item.notice) && <label className="checkbox-row"><input type="checkbox" checked={genericAccepted} onChange={(event) => { setGenericAccepted(event.target.checked); setErrors([]); }}/><span>Confermo il formaggio spalmabile classico e accetto i valori generici, non quelli ufficiali della marca.</span></label>}
        <button className="button button-primary" onClick={confirmParsedMeal}>Conferma il pasto <ArrowRight size={15}/></button>
      </section>}

      <details className="meal-catalog">
        <summary><Plus size={15}/>Oppure scegli gli alimenti dal catalogo</summary>
        <div className="meal-add-row">
          <label className="field">Alimento del pasto
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">Scegli un alimento</option>
              {INGREDIENTS.filter((food) => !base.some((item) => item.ingredientId === food.id)).map((food) => <option key={food.id} value={food.id}>{food.name}</option>)}
            </select>
          </label>
          <label className="field">g / porzione<input type="number" min=".1" max="5000" step=".1" value={selectedGrams} onChange={(event) => setSelectedGrams(event.target.value)}/></label>
          <button className="button button-secondary" onClick={addBase}><Plus size={15}/>Aggiungi</button>
          {selectedId && <button className="icon-button" aria-label="Annulla selezione alimento" onClick={() => setSelectedId("")}><X size={15}/></button>}
        </div>
      </details></>}

      {errors.length > 0 && <div className="meal-errors" role="alert">{errors.map((error, index) => <p key={index}>{error}</p>)}</div>}
      {base.length > 0 ? (
        <div className="meal-base">
          <div className="meal-part-title"><LockKeyhole size={15}/><h3>Questo pasto resta la tua base</h3><span>Quantita fisse</span></div>
          {base.map((item) => {
            const food = getIngredient(item.ingredientId);
            const restriction = food ? ingredientRestriction(food, input.preferences) : "Alimento non piu presente nel catalogo.";
            const requiredTotal = (item.dietGrams ?? 0) * servings;
            return (
              <div className="meal-base-item" key={item.ingredientId}>
                <span className="ingredient-emoji">{food?.emoji ?? "?"}</span>
                <div className="meal-base-name">
                  <strong>{food?.name ?? item.ingredientId}</strong>
                  <span>{food?.state}</span>
                  <small>{formatNumber(requiredTotal, 1)} g totali per {servings} {servings === 1 ? "porzione" : "porzioni"}</small>
                  {restriction && <p className="form-error">{restriction}</p>}
                  {item.availableGrams < requiredTotal && <button className="text-button" onClick={() => {
                    if (!window.confirm(`Confermi di avere ${formatNumber(requiredTotal, 1)} g di ${food?.name ?? item.ingredientId} per tutte le porzioni?`)) return;
                    onChange((current) => ({ ...current, pantry: current.pantry.map((entry) => entry.ingredientId === item.ingredientId ? { ...entry, availableGrams: requiredTotal } : entry) }));
                  }}>Conferma {formatNumber(requiredTotal, 1)} g disponibili</button>}
                </div>
                <label className="meal-fixed-quantity"><input aria-label={`Grammi del pasto ${food?.name ?? item.ingredientId}`} type="number" min=".1" max="5000" step=".1"
                  readOnly={lockedBase}
                  value={drafts[item.ingredientId] ?? item.dietGrams ?? ""}
                  onChange={(event) => changeBase(item, event.target.value)}/><span>g / porz.</span></label>
                {!lockedBase && <button className="icon-button" aria-label={`Rimuovi dal pasto ${food?.name ?? item.ingredientId}`} onClick={() => {
                  onChange((current) => ({ ...current, pantry: current.pantry.filter((entry) => entry.ingredientId !== item.ingredientId) }));
                  clearDraft(item.ingredientId);
                }}><X size={16}/></button>}
              </div>
            );
          })}
          {baseline && <div className="meal-base-macros"><Flame size={14}/><span>Pasto originale: <strong>{formatNumber(baseline.kcal)} kcal</strong></span><span>{formatNumber(baseline.protein, 1)} g proteine</span><span>{formatNumber(baseline.carbs, 1)} g carbo</span><span>{formatNumber(baseline.fat, 1)} g grassi</span><small>Stime per porzione, prima delle aggiunte.</small></div>}
        </div>
      ) : (
        <div className="meal-empty-hint"><Info size={18}/><p>Non serve inventare una ricetta: dimmi il pasto. Per esempio manzo e zucchine possono diventare mini burger con un contorno dorato.</p></div>
      )}

      {base.length > 0 && <div className="meal-extras" id="meal-extras" tabIndex={-1}>
        {proposal && <div className="chef-proposal-card">
          <ChefExtraProposal proposal={proposal}/>
          <button className="button button-primary" disabled={pending || proposal.extras.every((extra) => extras.some((item) => item.ingredientId === extra.ingredientId))}
            onClick={() => {
              try { onChange(confirmChefExtras(input, proposal.extras)); setErrors([]); }
              catch (error) { setErrors([error instanceof Error ? error.message : "Impossibile confermare le aggiunte."]); }
            }}>Ho questi extra, usali</button>
        </div>}
        <div className="meal-part-title"><Sparkles size={17}/><h3>Un piccolo extra, molto piu gusto</h3></div>
        <p>Preferisci scegliere uno alla volta? <strong>Seleziona solo gli extra che hai.</strong> Sono proposte compatibili con i tuoi alimenti, non una lista uguale per qualsiasi pasto. Le quantita restano massimi per porzione.</p>
        <div className="meal-extra-grid">{suggestions.map((extra) => {
          const food = getIngredient(extra.ingredientId)!;
          const selected = extras.find((item) => item.ingredientId === extra.ingredientId);
          const grams = selected ? selected.availableGrams / servings : extra.grams;
          const restriction = ingredientRestriction(food, input.preferences);
          return (
            <div className={`meal-extra ${selected ? "meal-extra-selected" : ""} ${restriction ? "meal-extra-restricted" : ""}`} key={extra.ingredientId}>
              <label className="meal-extra-check">
                <input type="checkbox" aria-label={`Ho ${food.name}`} checked={Boolean(selected)} disabled={Boolean(restriction && !selected)}
                  onChange={(event) => toggleExtra(extra.ingredientId, extra.grams, event.target.checked)}/>
                <span className="ingredient-emoji">{food.emoji}</span><strong>{food.name}</strong>
                {selected && <Check size={14}/>}
              </label>
              <p>{restriction ?? extra.reason}</p>
              {selected ? <label className="meal-extra-quantity"><span>Fino a</span><input type="number" aria-label={`Massimo extra ${food.name}`} min=".1" max={extra.maxGrams} step=".1"
                value={drafts[extra.ingredientId] ?? Number(grams.toFixed(2))}
                onChange={(event) => changeExtra(extra.ingredientId, event.target.value, extra.maxGrams)}/><span>g / porzione</span></label> :
                <span className="meal-extra-limit">Proposta: fino a {extra.grams} g / porzione</span>}
              <small>Fino a +{formatNumber(food.nutrients.kcal * grams / 100)} kcal per porzione{selected ? " se utilizzati tutti" : " se confermi"}.</small>
            </div>
          );
        })}</div>
        {extras.filter((item) => !suggestions.some((extra) => extra.ingredientId === item.ingredientId)).length > 0 && <div className="meal-existing-extras"><strong>Altre aggiunte gia disponibili</strong>
          {extras.filter((item) => !suggestions.some((extra) => extra.ingredientId === item.ingredientId)).map((item) => <div key={item.ingredientId}><span>{getIngredient(item.ingredientId)?.name ?? item.ingredientId} · {formatNumber(item.availableGrams, 1)} g totali</span><button className="icon-button" aria-label={`Rimuovi aggiunta ${getIngredient(item.ingredientId)?.name ?? item.ingredientId}`} onClick={() => toggleExtra(item.ingredientId, 0, false)}><X size={14}/></button></div>)}
        </div>}
        {unconfirmed.length > 0 && <p className="micro-copy">{unconfirmed.length} alimenti della modalita frigo non sono autorizzati come aggiunte a questo pasto. Se vuoi usarli, confermali qui.</p>}
        <div className="meal-extra-note"><LockKeyhole size={15}/><p>{extras.length ? `${extras.length} aggiunte disponibili. ` : "Nessuna aggiunta confermata. "}Non riduciamo carne, verdure o altri alimenti del pasto per compensarle. Nel risultato vedrai esattamente cosa aggiungono a calorie e macros.</p></div>
      </div>}
    </section>
  );
}
