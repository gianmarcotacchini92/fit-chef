"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Plus, Trash2 } from "lucide-react";
import { diaryEntrySchema, type DiaryEntry, type FoodSnapshot } from "@/lib/nutrition-diary";
import { parseSmartMeal } from "@/lib/smart-meal";
import type { WeekMeal } from "@/lib/types";

const MEALS: { id: WeekMeal; label: string }[] = [
  { id: "breakfast", label: "Colazione" }, { id: "lunch", label: "Pranzo" },
  { id: "snack", label: "Spuntino" }, { id: "dinner", label: "Cena" },
];
type Item = { key: string; food: FoodSnapshot; grams: string; note: string; estimated: boolean };

export function SmartMealInput({ date, savedFoods, onAdd }: {
  date: string; savedFoods: FoodSnapshot[]; onAdd: (entries: DiaryEntry[]) => void;
}) {
  const [description, setDescription] = useState("");
  const [meal, setMeal] = useState<WeekMeal>("dinner");
  const [items, setItems] = useState<Item[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);

  const total = useMemo(() => items.reduce((sum, item) => {
    const grams = Number(item.grams.replace(",", "."));
    if (!Number.isFinite(grams) || grams <= 0) return sum;
    const scale = grams / 100;
    return {
      kcal: sum.kcal + item.food.per100g.kcal * scale,
      protein: sum.protein + item.food.per100g.protein * scale,
      carbs: sum.carbs + item.food.per100g.carbs * scale,
      fat: sum.fat + item.food.per100g.fat * scale,
    };
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 }), [items]);

  const invalid = items.some((item) => !item.grams.trim() || !Number.isFinite(Number(item.grams.replace(",", "."))) ||
    Number(item.grams.replace(",", ".")) <= 0 || Number(item.grams.replace(",", ".")) > 5000);

  function interpret() {
    const result = parseSmartMeal(description, savedFoods);
    setItems(result.items.map((item) => ({
      key: crypto.randomUUID(), food: item.food, grams: String(item.grams), note: item.description,
      estimated: item.estimated || item.food.id.startsWith("estimate-"),
    })));
    setWarnings(result.warnings);
    setReady(true);
    setMessage("");
  }

  function register() {
    if (!ready || !items.length || warnings.length || invalid) return;
    const createdAt = new Date().toISOString();
    const result = diaryEntrySchema.array().safeParse(items.map((item) => ({
      id: crypto.randomUUID(), food: item.food,
      date, meal, grams: Number(item.grams.replace(",", ".")), createdAt,
    })));
    if (!result.success) { setMessage("Controlla i pesi inseriti e la data selezionata."); return; }
    onAdd(result.data);
    setDescription(""); setItems([]); setWarnings([]); setReady(false);
    setMessage(`${result.data.length} alimenti registrati in ${MEALS.find((item) => item.id === meal)?.label} del ${date}.`);
  }

  return <section className="nf-card nf-smart-meal" aria-label="Descrivi il pasto">
    <div className="nf-section-heading">
      <div><p className="nf-eyebrow">GRATIS, SENZA AI ESTERNA</p><h2><MessageCircle size={20} aria-hidden="true"/> Racconta cosa hai mangiato</h2></div>
    </div>
    <p className="nf-muted">Esempi: «4 polpette in bianco, 2 fette di arrosto di maiale» oppure «3 pezzi di margherita, un supplì» oppure «90 g riso, 150 g pollo». Il testo resta sul dispositivo; non viene inviato a un servizio AI.</p>
    <label className="nf-field">Descrizione del pasto
      <textarea rows={3} maxLength={1500} value={description} placeholder="Ho mangiato..." onChange={(event) => {
        setDescription(event.target.value); setReady(false); setItems([]); setWarnings([]); setMessage("");
      }}/>
    </label>
    <div className="nf-smart-meal-actions">
      <label className="nf-field">Pasto
        <select value={meal} onChange={(event) => setMeal(event.target.value as WeekMeal)}>
          {MEALS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <button type="button" className="nf-button" onClick={interpret} disabled={!description.trim()}><Plus size={16}/> Interpreta il pasto</button>
    </div>
    {ready && <div className="nf-smart-meal-result">
      {items.map((item) => <div className="nf-food-row" key={item.key}>
        <div className="nf-smart-meal-line">
          <div><strong>{item.food.name}</strong><p className="nf-muted">{item.note}{item.estimated ? " · Stima da verificare" : ""}</p></div>
          <label className="nf-field">Grammi
            <input type="number" min="0.1" max="5000" step="0.1" value={item.grams} aria-label={`Grammi per ${item.food.name}`}
              onChange={(event) => setItems((old) => old.map((row) => row.key === item.key ? { ...row, grams: event.target.value } : row))}/>
          </label>
          <button type="button" className="nf-text-button" aria-label={`Rimuovi ${item.food.name}`}
            onClick={() => setItems((old) => old.filter((row) => row.key !== item.key))}><Trash2 size={16}/></button>
        </div>
      </div>)}
      {warnings.length > 0 && <div className="nf-alert" role="alert">
        <strong>Da chiarire prima di registrare:</strong>
        <ul>{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>
        <p>Correggi la frase e premi di nuovo «Interpreta il pasto». Nessun alimento viene ignorato di nascosto.</p>
      </div>}
      {items.length > 0 && <>
        <div className="nf-smart-meal-totals">
          <strong>{Math.round(total.kcal)} kcal</strong>
          <span>P {total.protein.toFixed(1)} g · C {total.carbs.toFixed(1)} g · G {total.fat.toFixed(1)} g</span>
        </div>
        {items.some((item) => item.estimated) && <p className="nf-muted">Alcune porzioni e ricette sono stime indicative, non valori misurati del tuo piatto. Controlla i grammi e considera ingredienti, olio e condimenti prima di registrare.</p>}
        <button className="nf-button" type="button" disabled={warnings.length > 0 || invalid} onClick={register}>Conferma e registra {items.length} alimenti</button>
      </>}
    </div>}
    {message && <p className="nf-alert" role="status">{message}</p>}
  </section>;
}
