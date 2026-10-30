"use client";

import { useMemo, useState } from "react";
import { MessageCircle, Plus, Trash2 } from "lucide-react";
import { diaryEntrySchema, type DiaryEntry, type FoodSnapshot } from "@/lib/nutrition-diary";
import { parseSmartMeal } from "@/lib/smart-meal";
import { detectRusticPie } from "@/lib/rustic-pie";
import { RusticPieGuide } from "./rustic-pie-guide";
import type { WeekMeal } from "@/lib/types";

const MEALS: { id: WeekMeal; label: string }[] = [
  { id: "breakfast", label: "Colazione" }, { id: "lunch", label: "Pranzo" },
  { id: "snack", label: "Spuntino" }, { id: "dinner", label: "Cena" },
];
type Item = { key: string; food: FoodSnapshot; grams: string; note: string; estimated: boolean };

export function SmartMealInput({ date, savedFoods, onAdd, onSaveFood }: {
  date: string; savedFoods: FoodSnapshot[]; onAdd: (entries: DiaryEntry[]) => void;
  onSaveFood: (food: FoodSnapshot) => void;
}) {
  const [description, setDescription] = useState("");
  const [meal, setMeal] = useState<WeekMeal>("dinner");
  const [items, setItems] = useState<Item[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [guided, setGuided] = useState<{ slices: number; size: "small" | "medium" | "large" } | null>(null);

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
    const rustica = detectRusticPie(description);
    if (rustica) {
      setGuided({ slices: rustica.slices, size: rustica.size });
      setItems([]); setReady(false);
      const parts = description.split(/[,;\n]/).filter(x => x.trim());
      setWarnings(parts.length > 1 ? ["Per evitare di saltare alimenti, inserisci prima la torta rustica e poi gli altri cibi separatamente."] : []);
      setMessage("");
      return;
    }
    setGuided(null);
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
    setDescription(""); setItems([]); setWarnings([]); setReady(false); setGuided(null);
    setMessage(`${result.data.length} alimenti registrati in ${MEALS.find((item) => item.id === meal)?.label} del ${date}.`);
  }

  return <section className="nf-card nf-smart-meal" aria-label="Descrivi il pasto">
    <div className="nf-section-heading">
      <div><p className="nf-eyebrow">GRATIS, SENZA AI ESTERNA</p><h2><MessageCircle size={20} aria-hidden="true"/> Racconta cosa hai mangiato</h2></div>
    </div>
    <p className="nf-muted">Esempi: «4 polpette in bianco, 2 fette di arrosto di maiale» oppure «3 pezzi di margherita, un supplì» oppure «90 g riso, 150 g pollo». Il testo resta sul dispositivo; non viene inviato a un servizio AI.</p>
    <label className="nf-field">Descrizione del pasto
      <textarea rows={3} maxLength={1500} value={description} placeholder="Ho mangiato..." onChange={(event) => {
        setDescription(event.target.value); setReady(false); setItems([]); setWarnings([]); setMessage(""); setGuided(null);
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
    {guided && <>
      {savedFoods.filter(food => food.id.startsWith("personal-rustic-")).length > 0 && <div className="nf-food-row">
        <strong>Hai già salvato una torta rustica?</strong>
        <p className="nf-muted">Puoi riutilizzare la tua precedente stima, senza ricomporre il piatto.</p>
        {savedFoods.filter(food => food.id.startsWith("personal-rustic-")).map(food => {
          const match = /Porzione salvata: ([0-9.]+) g per ([0-9]+) fette/.exec(food.source);
          const grams = match ? Number(match[1]) / Number(match[2]) * (guided.slices || 1) : 0;
          return <button type="button" key={food.id} className="nf-text-button" disabled={!Number.isFinite(grams) || grams <= 0 || grams > 5000}
            onClick={() => {
              setItems([{ key: crypto.randomUUID(), food, grams: String(grams), note: "Porzione riutilizzata dal tuo piatto salvato: verifica dimensioni e ingredienti.", estimated: true }]);
              setReady(true); setWarnings([]); setMessage("Piatto personale recuperato, verifica i grammi prima di registrarlo.");
            }}>
            Usa {food.name} ({Math.round(grams)} g indicativi)
          </button>;
        })}
      </div>}

      {warnings.length > 0 ? <div className="nf-alert" role="alert">{warnings.join(" ")}</div>
      : <RusticPieGuide key={description} initialSlices={guided.slices} initialSize={guided.size} onSave={onSaveFood}
          onPreview={(food, grams, note) => {
            setItems([{ key: crypto.randomUUID(), food, grams: String(grams), note, estimated: true }]);
            setWarnings([]); setReady(true);
            setMessage("Stima in anteprima. Controlla i dati prima di registrare.");
          }}/>
      }
    </>}
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
