"use client";

import { useState } from "react";
import {
  emptyWeeklyDraft, parseWeeklyPlanJson, replaceWeeklyPlan, resolveWeeklyMeal, selectedWeeklyOption,
  WEEK_DAYS, WEEK_MEALS, WEEKLY_PLAN_FILE_LIMIT, weeklyMealKey, weeklyQuantityKey,
} from "@/lib/weekly-diet";
import { getIngredient } from "@/lib/catalog";
import { catalogFood, type DiaryEntry } from "@/lib/nutrition-diary";
import type { WeeklyDietState } from "@/lib/types";

type Props = {
  state: WeeklyDietState;
  date: string;
  onChange: (state: WeeklyDietState) => void;
  onAdd: (entries: DiaryEntry[]) => void;
};

export function NutritionWeek({ state, date, onChange, onAdd }: Props) {
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const key = weeklyMealKey(state.day, state.meal);
  const draft = state.drafts[key] ?? emptyWeeklyDraft();
  const meal = state.plan?.[state.day][state.meal];
  const updateDraft = (change: Partial<typeof draft>) => {
    onChange({ ...state, drafts: { ...state.drafts, [key]: { ...draft, ...change } } });
    setError("");
  };

  async function importPlan(file: File) {
    setImporting(true);
    setError("");
    try {
      if (file.size > WEEKLY_PLAN_FILE_LIMIT) throw new Error("Il piano supera 512 KB.");
      const plan = parseWeeklyPlanJson(await file.text());
      if (state.plan && !window.confirm("Sostituire il piano e azzerare le sue scelte? Il diario e le ricette salvate restano invariati.")) return;
      onChange(replaceWeeklyPlan(state, plan));
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
            {option && (option.grams === null ? <label className="nf-field">Grammi {slot.label}
              <input type="number" min="0.1" max="5000" step="0.1" value={draft.grams[weeklyQuantityKey(slot, option)] ?? ""} onChange={(event) => updateDraft({
                grams: { ...draft.grams, [weeklyQuantityKey(slot, option)]: event.target.value }, confirmed: false,
              })}/>
            </label> : <p><strong>{option.grams} g</strong> previsti per una porzione</p>)}
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
