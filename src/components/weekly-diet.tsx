"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, Info, LockKeyhole } from "lucide-react";
import { getIngredient } from "@/lib/catalog";
import { formatNumber } from "@/lib/pantry";
import {
  emptyWeeklyDraft, parseWeeklyPlanJson, replaceWeeklyPlan, selectedWeeklyOption, WEEK_DAYS, WEEK_MEALS, WEEKLY_PLAN_FILE_LIMIT,
  weeklyMealIsApplied, weeklyMealKey, weeklyQuantityKey, weeklySuggestedMinutes,
} from "@/lib/weekly-diet";
import type { RecipeInput, WeekDay, WeekMeal, WeeklyDietState, WeeklyMealDraft } from "@/lib/types";

type Props = {
  state: WeeklyDietState;
  input: RecipeInput;
  onChange: (state: WeeklyDietState) => void;
  onApply: () => string[];
  onManual: () => void;
  onMaxTime: (minutes: number) => void;
  onMigrate?: () => Promise<void> | void;
};

export function WeeklyDiet({ state, input, onChange, onApply, onManual, onMaxTime, onMigrate }: Props) {
  const [errors, setErrors] = useState<string[]>([]);
  const [fileError, setFileError] = useState("");
  const [importing, setImporting] = useState(false);
  const key = weeklyMealKey(state.day, state.meal);
  const plan = state.plan?.[state.day][state.meal];
  const draft = state.drafts[key] ?? emptyWeeklyDraft();
  const applied = weeklyMealIsApplied(state, input);
  const suggestedMinutes = plan ? weeklySuggestedMinutes(plan, input.preferences.servings) : undefined;
  const dayLabel = WEEK_DAYS.find((day) => day.id === state.day)!.label;
  const mealLabel = WEEK_MEALS.find((meal) => meal.id === state.meal)!.label;

  function choose(day: WeekDay, meal: WeekMeal) {
    onChange({ ...state, day, meal });
    setErrors([]);
  }
  function updateDraft(change: Partial<WeeklyMealDraft>) {
    onChange({ ...state, appliedKey: undefined, drafts: { ...state.drafts, [key]: { ...draft, ...change } } });
    setErrors([]);
  }

  async function importPlan(file: File) {
    setFileError("");
    setImporting(true);
    try {
      if (file.size > WEEKLY_PLAN_FILE_LIMIT) throw new Error("Il file del piano supera 512 KB.");
      const imported = parseWeeklyPlanJson(await file.text());
      if ((state.plan || Object.keys(state.drafts).length) &&
          !window.confirm("Sostituire il piano? Scelte, pesi inseriti e conferme dei pasti saranno azzerati. Ricette salvate e preferenze restano invariate.")) return;
      onChange(replaceWeeklyPlan(state, imported));
      setErrors([]);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Impossibile importare il piano.");
    } finally { setImporting(false); }
  }

  function exportPlan() {
    if (!state.plan) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(state.plan, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "fit-chef-piano-privato.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const transfer = <div className="weekly-plan-transfer">
    <label className="weekly-select-label">Importa piano privato JSON
      <input type="file" accept=".json,application/json" value="" disabled={importing}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPlan(file); }}/>
    </label>
    <p className="micro-copy">Solo il file del piano, massimo 512 KB. Il piano viene salvato nel tuo spazio personale, non nel codice pubblico. Se attivi la sincronizzazione, segue il tuo account.</p>
    {state.plan && <button className="text-button" onClick={exportPlan}>Esporta piano privato JSON</button>}
    {onMigrate && !state.plan && <button className="text-button" disabled={importing} onClick={async () => {
      setImporting(true);
      setFileError("");
      try { await onMigrate(); }
      catch (error) { setFileError(error instanceof Error ? error.message : "Migrazione locale non riuscita."); }
      finally { setImporting(false); }
    }}>Recupera il piano dal dispositivo locale</button>}
    {fileError && <p className="form-error" role="alert">{fileError}</p>}
  </div>;

  if (!plan) return <section className="card weekly-diet" id="weekly-diet" aria-labelledby="weekly-title">
    <div className="section-heading"><h2 id="weekly-title">La tua dieta settimanale</h2></div>
    <div className="weekly-free"><h3>Benvenuto: il tuo piano resta personale.</h3>
      <p>Nessuna dieta personale e inclusa nell&apos;app pubblica. Importa il tuo piano da un JSON privato oppure recuperalo dalla precedente installazione locale. Non inventiamo pasti o quantita.</p>
      {transfer}
      <p className="micro-copy">Per comporre un pasto senza piano settimanale, scegli &ldquo;Dal mio pasto&rdquo; nel compositore.</p>
    </div>
  </section>;

  return <section className="card weekly-diet" id="weekly-diet" aria-labelledby="weekly-title">
    <div className="section-heading"><div className="heading-with-step"><span className="section-step"><CalendarDays size={20}/></span><div><h2 id="weekly-title">La tua dieta settimanale</h2><p>Scegli giorno e pasto. Al resto pensa il tuo chef.</p></div></div></div>
    <div className="weekly-source-note"><Check size={15}/><span>Il piano che hai fornito: 7 giorni, 4 pasti al giorno. Quantita originali conservate, alternative da scegliere.</span></div>
    <div className="weekly-days" role="group" aria-label="Giorno della dieta">{WEEK_DAYS.map((day) =>
      <button key={day.id} aria-label={day.label} aria-pressed={state.day === day.id} className={state.day === day.id ? "selected" : ""} onClick={() => choose(day.id, state.meal)}>{day.short}<span className="weekly-day-dot"/></button>
    )}</div>
    <div className="weekly-meals" role="group" aria-label="Pasto della dieta">{WEEK_MEALS.map((meal) =>
      <button key={meal.id} aria-pressed={state.meal === meal.id} className={state.meal === meal.id ? "selected" : ""} onClick={() => choose(state.day, meal.id)}>{meal.label}</button>
    )}</div>
    <div className="weekly-current-heading"><h3>{dayLabel} <span>/</span> {mealLabel}</h3><span className="quiet-pill">{plan.freeChoice ? "Pasto libero" : `${plan.slots.length} alimenti`}</span></div>
    <div className="weekly-original"><span>NELLA TUA DIETA</span><p>{plan.original}</p></div>
    {plan.note && <p className="weekly-note"><Info size={15}/><span>{plan.note}</span></p>}
    {plan.freeChoice ? <div className="weekly-free">
      <h3>Qui scegli tu, come previsto dal piano.</h3><p>Indica gli alimenti e le quantita che vuoi usare. Non assegniamo ingredienti, porzioni o calorie a un pasto &ldquo;a piacere&rdquo; e non modifichiamo gli altri giorni.</p>
      <button className="button button-primary" onClick={onManual}>Componi questo pasto libero <ArrowRight size={15}/></button>
    </div> : <>
      <p className="weekly-review-intro">Controlla i prodotti e completa i campi vuoti. I pesi gia prescritti non vengono cambiati.</p>
      <div className="weekly-slots">{plan.slots.map((slot) => {
        const option = selectedWeeklyOption(slot, draft);
        const food = option ? getIngredient(option.ingredientId) : undefined;
        const quantityKey = option ? weeklyQuantityKey(slot, option) : "";
        return <div className="weekly-slot" key={slot.id}>
          <div className="weekly-slot-top"><span className="ingredient-emoji">{food?.emoji ?? "?"}</span><strong>{slot.label}</strong>
            {option?.grams !== null && option?.grams !== undefined && <span className="weekly-fixed"><LockKeyhole size={11}/>{formatNumber(option.grams)} g / porz.</span>}
          </div>
          {slot.options.length > 1 && <label className="weekly-select-label">Scegli l&apos;alternativa prevista
            <select className="field-select" aria-label={`Scelta ${slot.label}`} value={draft.choices[slot.id] ?? ""} onChange={(event) => updateDraft({ choices: { ...draft.choices, [slot.id]: event.target.value }, confirmed: false })}>
              <option value="">Seleziona, nessuna scelta automatica</option>
              {slot.options.map((choice) => <option key={choice.ingredientId} value={choice.ingredientId}>{getIngredient(choice.ingredientId)?.name ?? choice.label ?? choice.ingredientId}{choice.grams === null ? "" : ` - ${choice.grams} g`}</option>)}
            </select>
          </label>}
          {food && <div className="weekly-product"><span>{food.name}</span><small>{food.state}</small></div>}
          {slot.note && <p className="weekly-slot-note">{slot.note}</p>}
          {option?.grams === null && <label className="weekly-missing-quantity"><span>Grammi per porzione</span><div><input type="number" min=".1" max="5000" step=".1" placeholder="Da indicare" aria-label={`Grammi ${slot.label}`} value={draft.grams[quantityKey] ?? ""} onChange={(event) => updateDraft({ grams: { ...draft.grams, [quantityKey]: event.target.value }, confirmed: false })}/><span>g</span></div></label>}
          {option && !food && <p className="form-error">Voce non ancora disponibile. Il pasto non verra generato con alimenti mancanti.</p>}
        </div>;
      })}</div>
      <div className="weekly-confirmation">
        <label className="checkbox-row"><input type="checkbox" checked={draft.confirmed} onChange={(event) => updateDraft({ confirmed: event.target.checked })}/><span>Confermo prodotti, varianti, grammature e stati di peso indicati. I valori sono stime generiche, non quelli ufficiali delle marche: ho confrontato le etichette.</span></label>
        <p className="micro-copy">I grammi si riferiscono a una porzione. Nessun olio, zucchero o altro alimento viene aggiunto senza conferma.</p>
      </div>
      {suggestedMinutes !== undefined && input.preferences.maxTime < suggestedMinutes && <div className="weekly-time-note"><p>Per questo pasto prevedi almeno {suggestedMinutes} minuti per {input.preferences.servings} {input.preferences.servings === 1 ? "porzione" : "porzioni"}. Il tuo limite attuale e {input.preferences.maxTime} minuti.</p><button className="text-button" onClick={() => onMaxTime(suggestedMinutes)}>Imposta {suggestedMinutes} minuti per questo pasto</button></div>}
      {errors.length > 0 && <div className="meal-errors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
      {applied ? <div className="weekly-applied" role="status"><CheckCircle2 size={19}/><span>Pasto confermato. Puoi scegliere gli extra qui sotto e creare la ricetta.</span></div>
        : <button className="button button-primary weekly-apply" onClick={() => setErrors(onApply())}>Usa il pasto di {dayLabel.toLowerCase()} <ArrowRight size={15}/></button>}
      <button className="text-button weekly-manual" onClick={onManual}>Prodotto diverso? Personalizza fuori dal piano</button>
    </>}
    <details className="weekly-overview"><summary><CalendarDays size={16}/> Guarda tutta la settimana <ChevronDown size={15}/></summary>
      <div className="weekly-table-scroll" tabIndex={0} role="region" aria-label="Dieta settimanale completa"><table><caption>Piano originale: nessuna quantita mancante e stata inventata.</caption><thead><tr><th scope="col">Giorno</th>{WEEK_MEALS.map((meal) => <th scope="col" key={meal.id}>{meal.label}</th>)}</tr></thead>
        <tbody>{WEEK_DAYS.map((day) => <tr key={day.id}><th scope="row">{day.label}</th>{WEEK_MEALS.map((meal) => <td key={meal.id}><button aria-label={`Apri ${day.label} ${meal.label}`} onClick={() => { choose(day.id, meal.id); document.getElementById("weekly-title")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{state.plan![day.id][meal.id].original}</button></td>)}</tr>)}</tbody></table></div>
    </details>
    <details><summary>Importa o esporta il piano privato</summary>{transfer}</details>
  </section>;
}
