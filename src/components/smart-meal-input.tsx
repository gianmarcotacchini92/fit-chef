"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Plus, Trash2 } from "lucide-react";
import { diaryEntrySchema, type DiaryEntry, type FoodSnapshot } from "@/lib/nutrition-diary";
import { personalFoodMatches } from "@/lib/smart-meal";
import { isPilotRusticPhrase, mealPhrases, resolveMealPhrase, validateMealLanguage, type MealResolution } from "@/lib/meal-understanding";
import { MealResolutionCard } from "./meal-resolution-card";
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
  onSaveFood: (food: FoodSnapshot) => boolean;
}) {
  const [description, setDescription] = useState("");
  const [meal, setMeal] = useState<WeekMeal>("dinner");
  const [items, setItems] = useState<Item[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [guided, setGuided] = useState<(NonNullable<ReturnType<typeof detectRusticPie>> & { key: string })[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [resolutions, setResolutions] = useState<(MealResolution & { key: string })[]>([]);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const interpretation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (process.env.NEXT_PUBLIC_FIT_STATIC !== "true") {
      fetch("/api/config", { signal: controller.signal }).then(async response => {
        if (response.ok) { const data = await response.json(); if (!controller.signal.aborted) setAiAvailable(data.aiTextAvailable === true); }
      }).catch(() => undefined);
    }
    return () => {controller.abort(); interpretation.current?.abort();};
  }, []);

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

  function applyInterpretation(phrases: { text: string; query?: string }[], notice = "") {
    const nextGuides: typeof guided = [], nextItems: Item[] = [], nextWarnings: string[] = [];
    const nextResolutions: typeof resolutions = [];
    if (phrases.length > 30) nextWarnings.push("Troppi alimenti: dividi il pasto.");
    for (const phrase of phrases.slice(0, 30)) {
      const chunk = phrase.text.trim();
      const rustica = detectRusticPie(chunk);
      const personal = personalFoodMatches(chunk, savedFoods);
      const resolution = resolveMealPhrase(chunk, savedFoods, phrase.query);
      const resolvedPersonal = resolution.food && savedFoods.some(food => food.id === resolution.food?.id);
      const key = crypto.randomUUID();
      // The pilot guide must not swallow fillings it cannot model.
      const simpleRustic = rustica && isPilotRusticPhrase(chunk);
      if (simpleRustic && !resolvedPersonal && !(personal.length > 0 && /\b\d+(?:[.,]\d+)?\s*(?:g|gr|grammi)\b/i.test(chunk))) {
        nextGuides.push({ ...rustica, key });
        continue;
      }
      if (resolution.food && resolution.grams !== null && !resolution.quantity.invalid) {
        nextItems.push({ key, food: resolution.food, grams: String(resolution.grams), note: resolution.note, estimated: !resolution.food.id.startsWith("off-") });
      } else nextResolutions.push({ ...resolution, key });
    }
    setGuided(nextGuides); setResolutions(nextResolutions);
    setPending([...nextGuides.map(g => g.key), ...nextResolutions.map(r => r.key)]);
    setItems(nextItems); setWarnings(nextWarnings); setReady(true); setMessage(notice);
  }

  async function interpret() {
    interpretation.current?.abort();
    const controller = new AbortController(); interpretation.current = controller;
    const text = description.trim();
    setItems([]); setGuided([]); setResolutions([]); setPending([]); setReady(false); setWarnings([]); setMessage("");
    if (!aiAvailable || !aiConsent) { applyInterpretation(mealPhrases(text).map(text => ({ text }))); return; }
    setBusy(true);
    const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch("/api/meal-language", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-fit-ai-consent": "true" }, body: JSON.stringify({ text }) });
      if (!response.ok) throw new Error("AI non disponibile");
      const result = validateMealLanguage(await response.json(), text);
      if (interpretation.current !== controller || controller.signal.aborted) return;
      applyInterpretation(result.segments.filter(s => s.kind === "food").map(s => ({ text: s.text, query: s.query })), "Testo interpretato con AI. Conferma le corrispondenze e le quantità mancanti; i valori nutrizionali provengono dalle voci scelte.");
    } catch {
      if (interpretation.current === controller) applyInterpretation(mealPhrases(text).map(text => ({ text })), "Interpretazione AI non disponibile o incompleta: revisione locale del testo, nessun alimento registrato automaticamente.");
    } finally { clearTimeout(timer); if (interpretation.current === controller) setBusy(false); }
  }

  function invalidate(key: string) {
    setItems(old => old.filter(item => item.key !== key));
    setPending(old => old.includes(key) ? old : [...old, key]); setMessage("");
  }
  function preview(key: string, food: FoodSnapshot, grams: number, note: string) {
    setItems(old => [...old.filter(item => item.key !== key), { key, food, grams: String(grams), note, estimated: !food.id.startsWith("off-") }]);
    setPending(old => old.filter(id => id !== key)); setReady(true);
  }

  function register() {
    if (!ready || !items.length || warnings.length || pending.length || invalid) return;
    const createdAt = new Date().toISOString();
    const result = diaryEntrySchema.array().safeParse(items.map((item) => ({
      id: crypto.randomUUID(), food: item.food,
      date, meal, grams: Number(item.grams.replace(",", ".")), createdAt,
    })));
    if (!result.success) { setMessage("Controlla i pesi inseriti e la data selezionata."); return; }
    onAdd(result.data);
    setDescription(""); setItems([]); setWarnings([]); setReady(false); setGuided([]); setPending([]); setResolutions([]);
    setMessage(`${result.data.length} alimenti registrati in ${MEALS.find((item) => item.id === meal)?.label} del ${date}.`);
  }

  return <section className="nf-card nf-smart-meal" aria-label="Descrivi il pasto">
    <div className="nf-section-heading">
      <div><p className="nf-eyebrow">DESCRIVI, CONTROLLA, REGISTRA</p><h2><MessageCircle size={20} aria-hidden="true"/> Racconta cosa hai mangiato</h2></div>
    </div>
    <p className="nf-muted">Esempi: «4 polpette in bianco, 2 fette di arrosto di maiale» oppure «3 pezzi di margherita, un supplì» oppure «90 g riso, 150 g pollo». La revisione locale resta sul dispositivo. Le ricerche online e l’AI, quando disponibile, si attivano solo con la tua scelta.</p>
    <label className="nf-field">Descrizione del pasto
      <textarea rows={3} maxLength={1500} value={description} placeholder="Ho mangiato..." onChange={(event) => {
        interpretation.current?.abort(); interpretation.current = null; setBusy(false);
        setDescription(event.target.value); setReady(false); setItems([]); setWarnings([]); setMessage(""); setGuided([]); setPending([]); setResolutions([]);
      }}/>
    </label>
    {aiAvailable && <label className="nf-check"><input type="checkbox" checked={aiConsent} disabled={busy} onChange={e => setAiConsent(e.target.checked)}/>
      Usa AI per capire il testo: invia solo la descrizione a OpenAI, senza diario o profilo. Il servizio configurato usa API a consumo.
    </label>}
    <div className="nf-smart-meal-actions">
      <label className="nf-field">Pasto
        <select value={meal} onChange={(event) => setMeal(event.target.value as WeekMeal)}>
          {MEALS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <button type="button" className="nf-button" onClick={interpret} disabled={!description.trim() || busy}><Plus size={16}/> {busy ? "Interpreto…" : "Interpreta il pasto"}</button>
    </div>
    {guided.map(guide => <RusticPieGuide key={guide.key} initialSlices={guide.slices} initialSize={guide.size}
      initialGrams={guide.knownGrams} savedFoods={savedFoods.filter(food => food.id.startsWith("personal-rustic-"))}
      onSave={onSaveFood} onInvalidate={() => invalidate(guide.key)}
      onPreview={(food, grams, note) => preview(guide.key, food, grams, note)}/>) }
    {resolutions.map(resolution => <MealResolutionCard key={resolution.key} initial={resolution} savedFoods={savedFoods}
      onSave={onSaveFood} onInvalidate={() => invalidate(resolution.key)}
      onPreview={(food, grams, note) => preview(resolution.key, food, grams, note)}/>)}
    {pending.length > 0 && <p role="status">{pending.length} {pending.length === 1 ? "voce da completare" : "voci da completare"}: conferma solo alimento e quantità mancanti.</p>}
    {ready && <div className="nf-smart-meal-result">
      {items.map((item) => <div className="nf-food-row" key={item.key}>
        <div className="nf-smart-meal-line">
          <div><strong>{item.food.name}</strong><p className="nf-muted">{item.note}{item.estimated ? " · Stima da verificare" : ""}</p></div>
          <label className="nf-field">Grammi
            <input type="number" min="0.1" max="5000" step="0.1" value={item.grams} aria-label={`Grammi per ${item.food.name}`}
              onChange={(event) => setItems((old) => old.map((row) => row.key === item.key ? { ...row, grams: event.target.value, note: "Peso modificato manualmente; nutrienti per 100 g invariati. Il precedente intervallo di porzione non si applica." } : row))}/>
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
        <button className="nf-button" type="button" disabled={warnings.length > 0 || pending.length > 0 || invalid} onClick={register}>Conferma e registra {items.length} alimenti</button>
      </>}
    </div>}
    {message && <p className="nf-alert" role="status">{message}</p>}
  </section>;
}
