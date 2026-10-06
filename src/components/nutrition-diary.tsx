"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  Barcode, Camera, CameraOff, ChefHat, Plus, RefreshCw, Save, Search, Trash2,
} from "lucide-react";
import {
  diaryEntrySchema, entryNutrition, localDate, savedMealSchema, sumDiary,
  type DiaryEntry, type FoodSnapshot, type SavedMeal,
} from "@/lib/nutrition-diary";
import { fetchOffProduct, isValidBarcode, manualFoodSnapshot, searchCatalog, type OffLookup } from "@/lib/food-search";
import type { Nutrients, WeekMeal } from "@/lib/types";

type Targets = { kcal: number; protein: number; carbs: number; fat: number };

type Props = {
  entries: DiaryEntry[];
  savedMeals: SavedMeal[];
  date: string;
  onDate: (date: string) => void;
  onAdd: (entries: DiaryEntry[]) => void;
  onUpdate: (entry: DiaryEntry) => void;
  onDelete: (id: string) => void;
  onSaveMeal: (meal: SavedMeal) => void;
  onDeleteMeal: (id: string) => void;
  targets?: Targets;
};

type CartItem = { key: string; food: FoodSnapshot; grams: number };
type BuilderTab = "catalog" | "manual" | "barcode" | "recent" | "saved";

const MEAL_ORDER: WeekMeal[] = ["breakfast", "lunch", "snack", "dinner"];
const MEAL_LABELS: Record<WeekMeal, string> = { breakfast: "Colazione", lunch: "Pranzo", snack: "Spuntino", dinner: "Cena" };
const OFF_TERMS_URL = "https://world.openfoodfacts.org/terms-of-use";

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function parseGrams(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 && value <= 5_000 ? value : null;
}

// Minimal ambient typing for the feature-detected Shape Detection API: not in every lib.dom.d.ts yet,
// and most browsers still don't implement it, so every use below is behind a runtime capability check.
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorInstance = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;
declare global {
  interface Window { BarcodeDetector?: BarcodeDetectorConstructor }
}

function entryTotals(items: { food: FoodSnapshot; grams: number }[]): Nutrients {
  return items.reduce((total, item) => {
    const factor = item.grams / 100;
    return {
      kcal: total.kcal + item.food.per100g.kcal * factor,
      protein: total.protein + item.food.per100g.protein * factor,
      carbs: total.carbs + item.food.per100g.carbs * factor,
      fat: total.fat + item.food.per100g.fat * factor,
      fiber: total.fiber + item.food.per100g.fiber * factor,
    };
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
}

function EntryRow({ entry, onUpdate, onDelete }: { entry: DiaryEntry; onUpdate: (entry: DiaryEntry) => void; onDelete: (id: string) => void }) {
  const [gramsText, setGramsText] = useState(String(entry.grams));
  const [trackedGrams, setTrackedGrams] = useState(entry.grams);
  if (entry.grams !== trackedGrams) { setTrackedGrams(entry.grams); setGramsText(String(entry.grams)); }
  const nutrition = entryNutrition(entry);

  function commit() {
    const value = parseGrams(gramsText);
    if (value === null) { setGramsText(String(entry.grams)); return; }
    if (value === entry.grams) return;
    const parsed = diaryEntrySchema.safeParse({ ...entry, grams: value });
    if (parsed.success) onUpdate(parsed.data); else setGramsText(String(entry.grams));
  }

  return <div className="nf-food-row">
    <strong>{entry.food.name}</strong> <span className="nf-muted">- {entry.food.state}</span>
    <label className="nf-field">Grammi
      <input type="number" min="0.1" max="5000" step="0.1" value={gramsText} aria-label={`Grammi per ${entry.food.name}`}
        onChange={(event) => setGramsText(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); } }}/>
    </label>
    <p>{round(nutrition.kcal)} kcal - P {round(nutrition.protein, 1)} g - C {round(nutrition.carbs, 1)} g - G {round(nutrition.fat, 1)} g - Fibre {round(nutrition.fiber, 1)} g</p>
    <button className="nf-text-button" onClick={() => { if (window.confirm(`Eliminare "${entry.food.name}" dal diario?`)) onDelete(entry.id); }}>
      <Trash2 size={16}/>Elimina
    </button>
  </div>;
}

export function NutritionDiary({ entries, savedMeals, date, onDate, onAdd, onUpdate, onDelete, onSaveMeal, onDeleteMeal, targets }: Props) {
  const [meal, setMeal] = useState<WeekMeal>("lunch");
  const [tab, setTab] = useState<BuilderTab>("catalog");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [applyingMealId, setApplyingMealId] = useState<string | null>(null);

  // Catalog search
  const [query, setQuery] = useState("");
  const [catalogGrams, setCatalogGrams] = useState<Record<string, string>>({});
  const results = useMemo(() => searchCatalog(query, 10), [query]);

  // Manual custom food
  const [manualName, setManualName] = useState("");
  const [manualState, setManualState] = useState("");
  const [manualGrams, setManualGrams] = useState("100");
  const [manualKcal, setManualKcal] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");
  const [manualFiber, setManualFiber] = useState("");

  // Barcode lookup
  const [barcode, setBarcode] = useState("");
  const [offLoading, setOffLoading] = useState(false);
  const [offResult, setOffResult] = useState<OffLookup | null>(null);
  const [offFiber, setOffFiber] = useState("");
  const [offGrams, setOffGrams] = useState("100");
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const lookupControllerRef = useRef<AbortController | null>(null);
  const cameraSupported = typeof window !== "undefined" && typeof window.BarcodeDetector === "function"
    && typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

  const daySummary = useMemo(() => sumDiary(entries, date), [entries, date]);

  function stopScanner() {
    if (scanTimerRef.current !== null) { window.clearInterval(scanTimerRef.current); scanTimerRef.current = null; }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }

  useEffect(() => () => { stopScanner(); lookupControllerRef.current?.abort(); }, []);

  async function lookupBarcode(code: string) {
    lookupControllerRef.current?.abort();
    const controller = new AbortController();
    lookupControllerRef.current = controller;
    setOffLoading(true);
    setOffResult(null);
    setOffFiber("");
    setError("");
    try {
      const result = await fetchOffProduct(code, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setOffResult(result);
    } finally {
      if (!controller.signal.aborted) setOffLoading(false);
    }
  }

  async function startScanner() {
    setCameraError("");
    if (!cameraSupported) { setCameraError("La lettura automatica del codice a barre non e supportata da questo browser: usa l'inserimento manuale."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("video");
      video.srcObject = stream;
      await video.play();
      setScanning(true);
      const detector = new window.BarcodeDetector!({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
      scanTimerRef.current = window.setInterval(() => {
        if (!videoRef.current) return;
        detector.detect(videoRef.current).then((codes) => {
          const match = codes.map((code) => code.rawValue).find((value) => isValidBarcode(value));
          if (match) { stopScanner(); setBarcode(match); void lookupBarcode(match); }
        }).catch(() => { /* transient decode failures between frames are expected */ });
      }, 400);
    } catch {
      setCameraError("Accesso alla fotocamera negato o non disponibile. Usa l'inserimento manuale del codice.");
      stopScanner();
    }
  }

  function addToCart(food: FoodSnapshot, gramsText: string) {
    const grams = parseGrams(gramsText);
    if (grams === null) { setError("Indica una quantita valida, maggiore di zero e fino a 5000 g."); return; }
    setCart((current) => [...current, { key: crypto.randomUUID(), food, grams }]);
    setError("");
    setNotice(`${food.name} aggiunto alla selezione da registrare.`);
  }

  function addManual() {
    try {
      const fields = [manualKcal, manualProtein, manualCarbs, manualFat, manualFiber];
      if (fields.some((value) => !value.trim())) throw new Error("Compila tutti i valori per 100 g, fibre incluse: scrivi 0 solo se l'etichetta indica 0.");
      const per100g: Nutrients = {
        kcal: Number(manualKcal.replace(",", ".")), protein: Number(manualProtein.replace(",", ".")),
        carbs: Number(manualCarbs.replace(",", ".")), fat: Number(manualFat.replace(",", ".")),
        fiber: Number(manualFiber.replace(",", ".")),
      };
      const food = manualFoodSnapshot({ name: manualName, state: manualState, per100g });
      addToCart(food, manualGrams);
      setManualName(""); setManualState(""); setManualKcal(""); setManualProtein(""); setManualCarbs(""); setManualFat(""); setManualFiber("");
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : "Alimento manuale non valido.");
    }
  }

  function addOffResult() {
    if (!offResult || offResult.status !== "ok") return;
    let fiber = offResult.product.fiber;
    if (fiber === null) {
      const parsed = Number(offFiber.trim().replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) { setError("Inserisci il valore di fibra per 100 g prima di aggiungere: Open Food Facts non lo riporta per questo prodotto."); return; }
      fiber = parsed;
    }
    const food: FoodSnapshot = {
      id: `off-${offResult.product.barcode}`,
      name: offResult.product.name,
      state: offResult.product.brands ? `confezionato, marca ${offResult.product.brands} (Open Food Facts)` : "confezionato (Open Food Facts)",
      source: `Open Food Facts (licenza ODbL), prodotto con codice a barre ${offResult.product.barcode}. Dati della community: verifica sempre l'etichetta.`
        + (offResult.product.fiber === null ? " Fibra non riportata dalla community: valore inserito manualmente dall'utente." : ""),
      per100g: { ...offResult.product.per100g, fiber },
      barcode: offResult.product.barcode,
    };
    addToCart(food, offGrams);
    setOffResult(null); setBarcode(""); setOffFiber("");
  }

  function recentFoods(limit = 10): { food: FoodSnapshot; grams: number }[] {
    const seen = new Set<string>();
    const result: { food: FoodSnapshot; grams: number }[] = [];
    for (const item of [...entries].sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
      if (seen.has(item.food.id)) continue;
      seen.add(item.food.id);
      result.push({ food: item.food, grams: item.grams });
      if (result.length >= limit) break;
    }
    return result;
  }

  function registerCart() {
    if (!cart.length || submitting) return;
    setSubmitting(true);
    try {
      const createdAt = new Date().toISOString();
      const candidates = cart.map((item) => ({ id: crypto.randomUUID(), date, meal, food: item.food, grams: item.grams, createdAt }));
      const parsed = z.array(diaryEntrySchema).min(1).safeParse(candidates);
      if (!parsed.success) { setError("Una o piu voci non sono valide: controlla quantita e valori nutrizionali."); return; }
      onAdd(parsed.data);
      setCart([]);
      setNotice(`Registrati ${parsed.data.length} alimenti in ${MEAL_LABELS[meal]} del ${date}.`);
    } finally {
      setSubmitting(false);
    }
  }

  function saveCartAsMeal() {
    if (!cart.length) return;
    const name = window.prompt("Nome del pasto da salvare (es. Colazione tipo)", "")?.trim();
    if (!name) return;
    const candidate = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), items: cart.map((item) => ({ food: item.food, grams: item.grams })) };
    const parsed = savedMealSchema.safeParse(candidate);
    if (!parsed.success) { setError("Il pasto non e valido: controlla alimenti e quantita."); return; }
    onSaveMeal(parsed.data);
    setNotice(`Pasto "${name}" salvato: potrai riusarlo in futuro senza cercare di nuovo gli alimenti.`);
  }

  function applySavedMeal(saved: SavedMeal) {
    if (applyingMealId === saved.id) return;
    setApplyingMealId(saved.id);
    try {
      const createdAt = new Date().toISOString();
      const candidates = saved.items.map((item) => ({ id: crypto.randomUUID(), date, meal, food: item.food, grams: item.grams, createdAt }));
      const parsed = z.array(diaryEntrySchema).min(1).safeParse(candidates);
      if (!parsed.success) { setError("Questo pasto salvato contiene valori non piu validi."); return; }
      onAdd(parsed.data);
      setNotice(`Pasto "${saved.name}" aggiunto a ${MEAL_LABELS[meal]} del ${date}.`);
    } finally {
      setApplyingMealId(null);
    }
  }

  function shiftDate(days: number) {
    const [year, month, day] = date.split("-").map(Number);
    const next = new Date(year, month - 1, day + days);
    onDate(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`);
  }

  const remainingKcal = targets ? targets.kcal - daySummary.total.kcal : null;

  return <section className="nf-diary">
    <div className="nf-card">
      <div className="nf-section-heading">
        <div><p className="nf-eyebrow">OGGI, NON UN PIANO IDEALE</p><h2>Riepilogo del {date}</h2></div>
        <div className="nf-tabs" role="group" aria-label="Cambia giorno">
          <button onClick={() => shiftDate(-1)} aria-label="Giorno precedente">Ieri</button>
          <button onClick={() => onDate(localDate())}>Oggi</button>
          <button onClick={() => shiftDate(1)} aria-label="Giorno successivo">Domani</button>
        </div>
      </div>
      <div className="nf-grid">
        <div className="nf-food-row">
          <strong>Calorie</strong>
          <p>{round(daySummary.total.kcal)} kcal consumate{targets ? ` di ${targets.kcal} kcal` : ""}</p>
          {targets && remainingKcal !== null && (remainingKcal >= 0
            ? <p>Rimanenti: <strong>{round(remainingKcal)} kcal</strong></p>
            : <p role="status">Eccesso: <strong>{round(Math.abs(remainingKcal))} kcal</strong> oltre l&apos;obiettivo</p>)}
          {targets && <progress value={Math.min(daySummary.total.kcal, targets.kcal)} max={targets.kcal}/>}
        </div>
        {(["protein", "carbs", "fat"] as const).map((macro) => <div className="nf-food-row" key={macro}>
          <strong>{macro === "protein" ? "Proteine" : macro === "carbs" ? "Carboidrati" : "Grassi"}</strong>
          <p>{round(daySummary.total[macro], 1)} g{targets ? ` di ${targets[macro]} g` : ""}</p>
          {targets && <progress value={Math.min(daySummary.total[macro], targets[macro])} max={targets[macro]}/>}
        </div>)}
        <div className="nf-food-row"><strong>Fibre</strong><p>{round(daySummary.total.fiber, 1)} g consumate</p><p className="nf-muted">Nessun obiettivo di fibre impostato: solo il totale del giorno.</p></div>
      </div>
      {!targets && <p className="nf-muted">Imposta profilo e obiettivi per vedere calorie rimanenti o in eccesso.</p>}
    </div>

    {MEAL_ORDER.map((mealId) => {
      const mealEntries = entries.filter((entry) => entry.date === date && entry.meal === mealId);
      return <div className="nf-card" key={mealId}>
        <div className="nf-section-heading">
          <div><h2>{MEAL_LABELS[mealId]}</h2><p className="nf-muted">{round(daySummary.meals[mealId].kcal)} kcal</p></div>
          <button className="nf-text-button" onClick={() => { setMeal(mealId); setNotice(`Nuove aggiunte andranno in ${MEAL_LABELS[mealId]}.`); }}>
            <Plus size={16}/>Aggiungi a {MEAL_LABELS[mealId]}
          </button>
        </div>
        {!mealEntries.length && <p className="nf-muted">Nessun alimento registrato.</p>}
        {mealEntries.map((entry) => <EntryRow key={entry.id} entry={entry} onUpdate={onUpdate} onDelete={onDelete}/>)}
      </div>;
    })}

    <div className="nf-card">
      <div className="nf-section-heading"><div><p className="nf-eyebrow">AGGIUNGI ALIMENTI</p><h2>Componi la selezione</h2></div></div>
      <label className="nf-field">Pasto di destinazione
        <select value={meal} onChange={(event) => setMeal(z.enum(["breakfast", "lunch", "snack", "dinner"]).parse(event.target.value))}>
          {MEAL_ORDER.map((id) => <option key={id} value={id}>{MEAL_LABELS[id]}</option>)}
        </select>
      </label>

      <div className="nf-tabs" role="tablist" aria-label="Modo di aggiunta alimento">
        <button role="tab" aria-selected={tab === "catalog"} onClick={() => { stopScanner(); setTab("catalog"); }}><Search size={16}/>Catalogo</button>
        <button role="tab" aria-selected={tab === "manual"} onClick={() => { stopScanner(); setTab("manual"); }}><ChefHat size={16}/>Manuale</button>
        <button role="tab" aria-selected={tab === "barcode"} onClick={() => setTab("barcode")}><Barcode size={16}/>Codice a barre</button>
        <button role="tab" aria-selected={tab === "recent"} onClick={() => { stopScanner(); setTab("recent"); }}><RefreshCw size={16}/>Recenti</button>
        <button role="tab" aria-selected={tab === "saved"} onClick={() => { stopScanner(); setTab("saved"); }}><Save size={16}/>Pasti salvati</button>
      </div>

      {tab === "catalog" && <div>
        <label className="nf-field">Cerca nel catalogo (nome o alias, es. &quot;pollo&quot;)
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="es. riso, yogurt, mandorle..."/>
        </label>
        {query.trim() && !results.length && <p className="nf-muted">Nessun alimento del catalogo corrisponde a questa ricerca. Prova il nome in italiano o un alias comune, oppure usa la scheda Manuale.</p>}
        <div className="nf-grid">{results.map((ingredient) => <div className="nf-food-row" key={ingredient.id}>
          <strong>{ingredient.emoji} {ingredient.name}</strong>
          <p className="nf-muted">{ingredient.state}</p>
          <label className="nf-field">Grammi
            <input type="number" min="0.1" max="5000" step="0.1" value={catalogGrams[ingredient.id] ?? String(ingredient.defaultGrams)}
              onChange={(event) => setCatalogGrams((current) => ({ ...current, [ingredient.id]: event.target.value }))}/>
          </label>
          <button className="nf-button" onClick={() => {
            const food: FoodSnapshot = { id: ingredient.id, name: ingredient.name, state: ingredient.state, source: ingredient.source, per100g: ingredient.nutrients };
            addToCart(food, catalogGrams[ingredient.id] ?? String(ingredient.defaultGrams));
          }}><Plus size={16}/>Aggiungi</button>
        </div>)}</div>
      </div>}

      {tab === "manual" && <div>
        <p className="nf-muted">Per un alimento confezionato o una ricetta tua, con valori per 100 g dall&apos;etichetta.</p>
        <div className="nf-grid">
          <label className="nf-field">Nome<input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="es. Barretta ai cereali"/></label>
          <label className="nf-field">Stato<input value={manualState} onChange={(event) => setManualState(event.target.value)} placeholder="es. confezionata, pronta"/></label>
          <label className="nf-field">Kcal per 100 g<input type="number" min="0" value={manualKcal} onChange={(event) => setManualKcal(event.target.value)}/></label>
          <label className="nf-field">Proteine per 100 g (g)<input type="number" min="0" value={manualProtein} onChange={(event) => setManualProtein(event.target.value)}/></label>
          <label className="nf-field">Carboidrati per 100 g (g)<input type="number" min="0" value={manualCarbs} onChange={(event) => setManualCarbs(event.target.value)}/></label>
          <label className="nf-field">Grassi per 100 g (g)<input type="number" min="0" value={manualFat} onChange={(event) => setManualFat(event.target.value)}/></label>
          <label className="nf-field">Fibre per 100 g (g)<input type="number" min="0" value={manualFiber} onChange={(event) => setManualFiber(event.target.value)}/></label>
          <label className="nf-field">Grammi da registrare<input type="number" min="0.1" max="5000" step="0.1" value={manualGrams} onChange={(event) => setManualGrams(event.target.value)}/></label>
        </div>
        <button className="nf-button" onClick={addManual}><Plus size={16}/>Aggiungi alla selezione</button>
      </div>}

      {tab === "barcode" && <div>
        <p className="nf-muted">Dati forniti da <a href={OFF_TERMS_URL} target="_blank" rel="noreferrer noopener">Open Food Facts (ODbL)</a>: una community aperta, non un database ufficiale. Viene inviato solo il codice a barre (con il nome dell&apos;app), nessun dato personale o di salute. La ricerca parte solo quando premi il pulsante, con un limite di richieste per rispettare Open Food Facts.</p>
        <label className="nf-field">Codice a barre (solo cifre)
          <input inputMode="numeric" pattern="[0-9]*" maxLength={20} value={barcode} onChange={(event) => setBarcode(event.target.value.replace(/[^0-9]/g, ""))}/>
        </label>
        <button className="nf-button" disabled={offLoading || !isValidBarcode(barcode)} onClick={() => void lookupBarcode(barcode)}>
          <Search size={16}/>{offLoading ? "Ricerca in corso..." : "Cerca il prodotto"}
        </button>
        {cameraSupported
          ? <button className="nf-text-button" onClick={() => (scanning ? stopScanner() : void startScanner())}>
              {scanning ? <><CameraOff size={16}/>Interrompi fotocamera</> : <><Camera size={16}/>Scansiona con la fotocamera</>}
            </button>
          : <p className="nf-muted"><CameraOff size={14}/> Lettura automatica non supportata su questo browser: usa l&apos;inserimento manuale del codice sopra.</p>}
        {/* Camera reads a barcode only: frames stay on the device, no food recognition or AI request is made. */}
        <div hidden={!scanning}>
          <video ref={videoRef} muted playsInline aria-label="Anteprima della fotocamera per leggere il codice a barre"/>
          <p className="nf-muted">Inquadra il codice a barre. La fotocamera e opzionale, legge solo il numero e non riconosce il cibo; le immagini restano sul dispositivo.</p>
        </div>
        {cameraError && <p className="nf-alert" role="alert">{cameraError}</p>}
        {offResult?.status === "not-found" && <p className="nf-alert" role="alert">{offResult.message}</p>}
        {offResult?.status === "error" && <p className="nf-alert" role="alert">{offResult.message}</p>}
        {offResult?.status === "ok" && <div className="nf-food-row">
          <strong>{offResult.product.name}</strong>
          {offResult.product.brands && <p className="nf-muted">{offResult.product.brands}</p>}
          <p>Per 100 g: {offResult.product.per100g.kcal} kcal - P {offResult.product.per100g.protein} g - C {offResult.product.per100g.carbs} g - G {offResult.product.per100g.fat} g</p>
          {offResult.product.fiber !== null
            ? <p>Fibre per 100 g: {offResult.product.fiber} g</p>
            : <label className="nf-field">Fibre per 100 g (g), non riportate da Open Food Facts: inseriscile dall&apos;etichetta prima di aggiungere
                <input type="number" min="0" value={offFiber} onChange={(event) => setOffFiber(event.target.value)}/>
              </label>}
          <label className="nf-field">Grammi da registrare<input type="number" min="0.1" max="5000" step="0.1" value={offGrams} onChange={(event) => setOffGrams(event.target.value)}/></label>
          <button className="nf-button" onClick={addOffResult}><Plus size={16}/>Aggiungi alla selezione</button>
          <p className="nf-muted">Anteprima: nessun alimento viene registrato nel diario finche non lo aggiungi esplicitamente.</p>
        </div>}
      </div>}

      {tab === "recent" && <div className="nf-grid">
        {!recentFoods().length && <p className="nf-muted">Nessun alimento recente: registra qualcosa per ritrovarlo qui.</p>}
        {recentFoods().map(({ food, grams }) => <div className="nf-food-row" key={food.id}>
          <strong>{food.name}</strong><p className="nf-muted">{food.state}</p><p>Ultima quantita: {grams} g</p>
          <button className="nf-button" onClick={() => addToCart(food, String(grams))}><Plus size={16}/>Aggiungi di nuovo</button>
        </div>)}
      </div>}

      {tab === "saved" && <div className="nf-grid">
        {!savedMeals.length && <p className="nf-muted">Nessun pasto salvato. Componi una selezione e usa il pulsante Salva come pasto qui sotto.</p>}
        {savedMeals.map((saved) => {
          const totals = entryTotals(saved.items);
          return <div className="nf-food-row" key={saved.id}>
            <strong>{saved.name}</strong>
            <p className="nf-muted">{saved.items.map((item) => `${item.food.name} ${item.grams} g`).join(", ")}</p>
            <p>{round(totals.kcal)} kcal totali</p>
            <button className="nf-button" disabled={applyingMealId === saved.id} onClick={() => applySavedMeal(saved)}>
              <Plus size={16}/>Aggiungi a {MEAL_LABELS[meal]}
            </button>
            <button className="nf-text-button" onClick={() => { if (window.confirm(`Eliminare il pasto salvato "${saved.name}"?`)) onDeleteMeal(saved.id); }}>
              <Trash2 size={16}/>Elimina pasto salvato
            </button>
          </div>;
        })}
      </div>}
    </div>

    {cart.length > 0 && <div className="nf-card">
      <h2>Selezione da registrare ({cart.length})</h2>
      {cart.map((item) => <div className="nf-food-row" key={item.key}>
        <strong>{item.food.name}</strong>
        <label className="nf-field">Grammi
          <input type="number" min="0.1" max="5000" step="0.1" value={item.grams}
            onChange={(event) => {
              const value = Number(event.target.value);
              setCart((current) => current.map((entry) => entry.key === item.key ? { ...entry, grams: Number.isFinite(value) ? value : entry.grams } : entry));
            }}/>
        </label>
        <button className="nf-text-button" onClick={() => setCart((current) => current.filter((entry) => entry.key !== item.key))}><Trash2 size={16}/>Rimuovi</button>
      </div>)}
      <p>Destinazione: <strong>{MEAL_LABELS[meal]}</strong>, {date}. Totale: {round(entryTotals(cart).kcal)} kcal.</p>
      <button className="nf-button" disabled={submitting} onClick={registerCart}><Plus size={16}/>Registra nel diario</button>
      <button className="nf-text-button" onClick={saveCartAsMeal}><Save size={16}/>Salva come pasto</button>
    </div>}

    {notice && <p className="nf-alert" role="status">{notice}</p>}
    {error && <p className="nf-alert" role="alert">{error}</p>}
  </section>;
}
