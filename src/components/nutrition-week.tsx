"use client";

import { useMemo, useState } from "react";
import {
  emptyWeeklyDraft, parseWeeklyPlanJson, replaceWeeklyPlan, resolveWeeklyMeal, selectedWeeklyOption,
  WEEK_DAYS, WEEK_MEALS, WEEKLY_PLAN_FILE_LIMIT, weeklyMealKey, weeklyQuantityKey,
} from "@/lib/weekly-diet";
import { getIngredient } from "@/lib/catalog";
import { plannedDay, adjustPlannedDay, applyDailyAdjustment, type DailyAdjustment } from "@/lib/daily-plan";
import { minimumDailyProtein } from "@/lib/nutrition-profile";
import type { MacroTargets } from "@/lib/nutrition-profile";
import { catalogFood, type DiaryEntry } from "@/lib/nutrition-diary";
import type { WeeklyDietState } from "@/lib/types";

type Props = {
  state: WeeklyDietState;
  date: string;
  onChange: (state: WeeklyDietState) => void;
  onAdd: (entries: DiaryEntry[]) => void;
  targets?: MacroTargets;
  weightKg?: number;
};

export function NutritionWeek({ state, date, onChange, onAdd, targets, weightKg }: Props) {
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [desiredKcal, setDesiredKcal] = useState("");
  const [locks, setLocks] = useState<string[]>([]);
  const [proposal, setProposal] = useState<DailyAdjustment | null>(null);
  const currentDay = useMemo(() => plannedDay(state, state.day, new Set(locks)), [state, locks]);
  const proteinFloor = weightKg && weightKg > 0 ? minimumDailyProtein(weightKg) : null;
  function previewDay() {
    setError("");
    setProposal(null);
    if (!weightKg) { setError("Imposta prima il peso nel Profilo e TDEE."); return; }
    try {
      setProposal(adjustPlannedDay(currentDay, Number(desiredKcal || targets?.kcal || ""), weightKg));
    } catch (err) { setError(err instanceof Error ? err.message : "Ricalcolo non riuscito."); }
  }
  function applyPreview() {
    if (!proposal?.reached) return;
    onChange(applyDailyAdjustment(state, state.day, proposal));
    setProposal(null);
    setError("");
  }
  const key = weeklyMealKey(state.day, state.meal);
  const draft = state.drafts[key] ?? emptyWeeklyDraft();
  const meal = state.plan?.[state.day][state.meal];
  const updateDraft = (change: Partial<typeof draft>) => {
    onChange({ ...state, drafts: { ...state.drafts, [key]: { ...draft, ...change } } });
    setError("");
    setProposal(null);
  };

  async function importPlan(file: File) {
    setImporting(true);
    setError("");
    try {
      if (file.size > WEEKLY_PLAN_FILE_LIMIT) throw new Error("Il piano supera 512 KB.");
      const plan = parseWeeklyPlanJson(await file.text());
      if (state.plan && !window.confirm("Sostituire il piano e azzerare le sue scelte? Il diario e le ricette salvate restano invariati.")) return;
      onChange(replaceWeeklyPlan(state, plan));
      setProposal(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Importazione del piano non riuscita.");
    } finally { setImporting(false); }
  }

  function recordMeal() {
    const result = resolveWeeklyMeal(state.day, state.meal, draft, state.plan);
    if (result.errors.length) { setError(result.errors.join(" ")); return; }
    const createdAt = new Date().toISOString();
    onAdd(result.items.map((item) => ({
      id: crypto.randomUUID(), date, meal: state.meal, createdAt,
      food: catalogFood(item.ingredientId), grams: item.grams,
    })));
  }

  return <section className="nf-card nf-week">
    <div className="nf-section-heading"><div><p className="nf-eyebrow">LA TUA DIETA, NON UN MENU GENERATO</p><h2>Piano settimanale</h2></div></div>
    <p className="nf-muted">Registra un pasto previsto e poi correggi nel diario quello che hai mangiato davvero. Il piano originale non viene modificato.</p>
    <label className="nf-field">Importa piano privato JSON
      <input type="file" accept=".json,application/json" disabled={importing} onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void importPlan(file);
        event.target.value = "";
      }}/>
    </label>
    <p className="nf-muted">Solo il tuo file del piano (massimo 512 KB). Nessuna dieta personale e inclusa nell&apos;app pubblica.</p>
    {!state.plan ? <p>Il piano gia salvato in FIT Chef resta qui dopo l&apos;aggiornamento o l&apos;accesso allo stesso account Google. Puoi anche importare il JSON privato.</p> : <>
      <div className="nf-tabs" role="group" aria-label="Giorno del piano">{WEEK_DAYS.map((day) =>
        <button key={day.id} aria-pressed={state.day === day.id} onClick={() => { onChange({ ...state, day: day.id }); setError(""); }}>{day.label}</button>)}</div>
      <div className="nf-tabs" role="group" aria-label="Pasto del piano">{WEEK_MEALS.map((entry) =>
        <button key={entry.id} aria-pressed={state.meal === entry.id} onClick={() => { onChange({ ...state, meal: entry.id }); setError(""); }}>{entry.label}</button>)}</div>
      <section className="nf-food-row" aria-label="Ricalcolo delle quantità della giornata">
        <h3>Ricalcola la giornata</h3>
        <p className="nf-muted">Anteprima senza modificare la dieta originale o il diario. Modifica solo le grammature del giorno selezionato, entro il 50–150% di ogni porzione. I pasti liberi e le quantità mancanti devono essere completati prima.</p>
        <label className="nf-field">Obiettivo calorie (kcal)
          <input type="number" min="1" max="10000" step="1" value={desiredKcal} placeholder={targets ? String(targets.kcal) : "es. 1900"}
            onChange={(event) => { setDesiredKcal(event.target.value); setProposal(null); }}/>
        </label>
        <p>Attuale (alimenti quantificati): <strong>{Math.round(currentDay.kcal)} kcal</strong> · P {Math.round(currentDay.protein * 10) / 10} g
          {proteinFloor !== null && <> · Minimo P <strong>{proteinFloor} g</strong></>}
        </p>
        {currentDay.errors.length > 0 && <div className="nf-alert" role="status"><strong>Prima di ricalcolare:</strong>
          <ul>{currentDay.errors.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
        {currentDay.items.length > 0 && <details><summary>Blocca le quantità da non modificare</summary>
          {currentDay.items.map((item) => {
            const lockKey = `${item.meal}:${item.quantityKey}`;
            return <label key={lockKey} className="nf-check">
              <input type="checkbox" checked={locks.includes(lockKey)} onChange={(event) => {
                setLocks((old) => event.target.checked ? [...old, lockKey] : old.filter((key) => key !== lockKey));
                setProposal(null);
              }}/>{item.label}: {item.grams} g ({item.meal})
            </label>;
          })}
        </details>}
        <button type="button" className="nf-button" disabled={currentDay.errors.length > 0 || !weightKg} onClick={previewDay}>Calcola nuova distribuzione</button>
        {proposal && <div className="nf-food-row" role="status">
          <strong>Risultato proposto: {Math.round(proposal.kcal)} kcal · P {Math.round(proposal.protein * 10) / 10} g</strong>
          <p className="nf-muted">{proposal.message}</p>
          <ul>{proposal.items.filter((item) => item.grams !== item.originalGrams).map((item) =>
            <li key={`${item.meal}:${item.quantityKey}`}>{item.label}: {item.originalGrams} → {item.grams} g</li>)}</ul>
          <button type="button" className="nf-button" disabled={!proposal.reached} onClick={applyPreview}>Applica alle quantità del piano</button>
        </div>}
      </section>
      <h3>{meal?.original}</h3>
      {meal?.note && <p className="nf-muted">{meal.note}</p>}
      {meal?.freeChoice ? <p className="nf-alert">Pasto libero: aggiungi alimenti e quantita dal diario. Non assegniamo calorie a un pasto non specificato.</p> : <>
        <div className="nf-grid">{meal?.slots.map((slot) => {
          const option = selectedWeeklyOption(slot, draft);
          const food = option ? getIngredient(option.ingredientId) : undefined;
          return <div className="nf-food-row" key={slot.id}>
            <strong>{slot.label}</strong>
            {slot.options.length > 1 && <label className="nf-field">Alternativa {slot.label}
              <select value={draft.choices[slot.id] ?? ""} onChange={(event) => updateDraft({
                choices: { ...draft.choices, [slot.id]: event.target.value }, confirmed: false,
              })}>
                <option value="">Scegli una sola alternativa</option>
                {slot.options.map((item) => <option key={item.ingredientId} value={item.ingredientId}>{item.label ?? getIngredient(item.ingredientId)?.name ?? item.ingredientId}</option>)}
              </select>
            </label>}
            {food && <p>{food.name} <span className="nf-muted">— {food.state}</span></p>}
            {option && <label className="nf-field">Grammi {slot.label}
              <input type="number" min="0.1" max="5000" step="0.1" value={option.grams === null ? (draft.grams[weeklyQuantityKey(slot, option)] ?? "") : (draft.overrides?.[weeklyQuantityKey(slot, option)] ?? String(option.grams))} onChange={(event) => updateDraft({
                ...(option.grams === null
                  ? { grams: { ...draft.grams, [weeklyQuantityKey(slot, option)]: event.target.value } }
                  : { overrides: { ...draft.overrides, [weeklyQuantityKey(slot, option)]: event.target.value } }), confirmed: false,
              })}/>
              {option.grams !== null && <span className="nf-muted">Piano originale: {option.grams} g</span>}
            </label>}
          </div>;
        })}</div>
        <label className="nf-check"><input type="checkbox" checked={draft.confirmed} onChange={(event) => updateDraft({ confirmed: event.target.checked })}/>Confermo alimenti, alternative, pesi e stato crudo/cotto. I valori generici non sostituiscono le etichette.</label>
        <button className="nf-button" onClick={recordMeal}>Registra il pasto del piano</button>
        <p className="nf-muted">Viene registrato nella data selezionata: <strong>{date}</strong>, non automaticamente nel giorno della settimana indicato dal piano.</p>
      </>}
    </>}
    {error && <p className="nf-alert" role="alert">{error}</p>}
  </section>;
}
