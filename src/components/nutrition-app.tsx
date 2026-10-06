"use client";

import { useEffect, useReducer, useState, type SetStateAction } from "react";
import { signOut } from "firebase/auth";
import { z } from "zod";
import { CalendarDays, ClipboardList, Download, Settings2, Utensils } from "lucide-react";
import { DEFAULT_MEAL_INPUT } from "@/lib/defaults";
import { getCloudClient } from "@/lib/cloud";
import { clearCloudBinding } from "@/lib/cloud-storage";
import { localStateSchema } from "@/lib/validation";
import { initialWeeklyDietState } from "@/lib/weekly-diet";
import { emptyNutritionState, nutritionStateSchema, targetsOnDate, type NutritionState } from "@/lib/nutrition-state";
import { diaryEntrySchema, savedMealSchema, localDate, type DiaryEntry, type SavedMeal } from "@/lib/nutrition-diary";
import type { BodyProfile, MacroTargets } from "@/lib/nutrition-profile";
import type { LocalState, WeekMeal } from "@/lib/types";
import { CloudAccount } from "./cloud-account";
import { PwaRegistration } from "./pwa-registration";
import { NutritionProfile } from "./nutrition-profile";
import { NutritionDiary } from "./nutrition-diary";
import { NutritionWeek } from "./nutrition-week";

const STORAGE_KEY = "fit-chef.workspace.v1";
const MIGRATION_KEY = "fit-chef.local-plan-migration.v1";
const STATIC_SITE = process.env.NEXT_PUBLIC_FIT_STATIC === "true";
type Tab = "diary" | "profile" | "week" | "archive";
const tabs = [
  { id: "diary", title: "Diario", icon: Utensils },
  { id: "profile", title: "Profilo e TDEE", icon: Settings2 },
  { id: "week", title: "La mia dieta", icon: CalendarDays },
  { id: "archive", title: "Archivio ricette", icon: ClipboardList },
] as const;

function initialWorkspace(): LocalState {
  return {
    version: 1, input: structuredClone(DEFAULT_MEAL_INPUT), recipes: [], favoriteIds: [], cookedIds: [],
    weeklyDiet: initialWeeklyDietState(), builderMode: "weekly", nutrition: emptyNutritionState(),
  };
}

type WorkspaceStore = { workspace: LocalState; error: string };
type WorkspaceAction =
  | { type: "restore"; change: SetStateAction<LocalState> }
  | { type: "nutrition"; change: (current: NutritionState) => NutritionState };

function reduceWorkspace(store: WorkspaceStore, action: WorkspaceAction): WorkspaceStore {
  if (action.type === "restore") return {
    workspace: typeof action.change === "function" ? action.change(store.workspace) : action.change, error: "",
  };
  const next = nutritionStateSchema.safeParse(action.change(store.workspace.nutrition ?? emptyNutritionState()));
  if (!next.success) return { ...store, error: `Modifica non salvata: ${next.error.issues.map((issue) => issue.message).join(" ")}` };
  return { workspace: { ...store.workspace, nutrition: next.data }, error: "" };
}

function download(contents: string, filename: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function NutritionApp() {
  const [store, dispatchWorkspace] = useReducer(reduceWorkspace, undefined, () => ({ workspace: initialWorkspace(), error: "" }));
  const workspace = store.workspace;
  const setWorkspace = (change: SetStateAction<LocalState>) => dispatchWorkspace({ type: "restore", change });
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(true);
  const [storageError, setStorageError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("diary");
  const [date, setDate] = useState("");
  const [archiveMeal, setArchiveMeal] = useState<WeekMeal>("lunch");
  const [busy, setBusy] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const nutrition = workspace.nutrition ?? emptyNutritionState();
  const latestCheckIn = [...nutrition.checkIns].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.id;

  useEffect(() => {
    const controller = new AbortController();
    async function hydrate() {
      let loaded = initialWorkspace();
      let canWrite = true;
      let errorMessage = "";
      let migrationNotice = "";
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) loaded = localStateSchema.parse(JSON.parse(raw));
        if (!STATIC_SITE && localStorage.getItem(MIGRATION_KEY) !== "done" && !loaded.weeklyDiet?.plan) {
          try {
            const response = await fetch("/api/weekly-diet", {
              cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
            });
            if (!response.ok) throw new Error("Il piano privato locale non e disponibile.");
            const result = z.strictObject({ plan: z.record(z.string(), z.unknown()).nullable() }).parse(await response.json());
            if (result.plan !== null) {
              loaded = localStateSchema.parse({ ...loaded, weeklyDiet: { ...(loaded.weeklyDiet ?? initialWeeklyDietState()), plan: result.plan } });
              if (controller.signal.aborted) return;
              localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
              localStorage.setItem(MIGRATION_KEY, "done");
            }
          } catch (error) {
            if (controller.signal.aborted) return;
            migrationNotice = `Il piano locale non e stato importato: ${error instanceof Error ? error.message : "errore di lettura"}. Puoi riprovare o importare il JSON dalla sezione La mia dieta.`;
          }
        }
      } catch (error) {
        errorMessage = `Dati locali non leggibili o incompatibili: ${error instanceof Error ? error.message : "errore del browser"}. Non saranno sovrascritti. Esporta la copia prima di ripristinare.`;
        canWrite = false;
      }
      if (controller.signal.aborted) return;
      setWorkspace(loaded);
      setWritable(canWrite);
      setStorageError(errorMessage);
      setNotice(migrationNotice);
      setDate(localDate());
      setReady(true);
    }
    void hydrate();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!ready || !writable) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace)); }
    catch (error) {
      // Preserve the in-memory diary and stop cloud writes until the failure is resolved.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageError(`Salvataggio locale non riuscito: ${error instanceof Error ? error.message : "spazio esaurito"}. Esporta il diario prima di chiudere.`);
      setWritable(false);
    }
  }, [workspace, ready, writable]);

  function updateNutrition(change: (current: NutritionState) => NutritionState) {
    if (!writable || busy || cloudBusy) { setNotice("Modifiche sospese: risolvi il problema di salvataggio o attendi la sincronizzazione."); return; }
    dispatchWorkspace({ type: "nutrition", change });
  }

  function addEntries(entries: DiaryEntry[]) {
    const parsed = z.array(diaryEntrySchema).min(1).safeParse(entries);
    if (!parsed.success) { setNotice("Alimenti o quantita non validi: nessun pasto e stato registrato."); return; }
    if (nutrition.entries.length + entries.length > 3000) { setNotice("Hai raggiunto il limite di 3000 voci. Esporta il diario e rimuovi le voci che non vuoi piu conservare prima di aggiungerne altre."); return; }
    if (new Set([...nutrition.entries, ...entries].map((entry) => entry.id)).size !== nutrition.entries.length + entries.length) {
      setNotice("Queste voci sono gia registrate: nessun duplicato e stato aggiunto."); return;
    }
    const repeated = entries.every((entry) => nutrition.entries.some((existing) =>
      existing.date === entry.date && existing.meal === entry.meal && existing.food.id === entry.food.id && existing.grams === entry.grams));
    if (repeated && !window.confirm("Questi alimenti con le stesse quantita sono gia nel pasto. Registrarli di nuovo, sommandone le calorie?")) return;
    updateNutrition((current) => ({ ...current, entries: [...current.entries, ...parsed.data] }));
    setNotice(`Registrate ${entries.length} ${entries.length === 1 ? "voce" : "voci"} nel diario del ${entries[0].date}.`);
  }

  function saveMeal(meal: SavedMeal) {
    const parsed = savedMealSchema.safeParse(meal);
    if (!parsed.success) { setNotice("Pasto non valido: controlla alimenti e quantita."); return; }
    if (nutrition.savedMeals.length >= 100) { setNotice("Hai raggiunto il limite di 100 pasti salvati. Rimuovine uno prima di salvarne un altro."); return; }
    if (nutrition.savedMeals.some((entry) => entry.id === meal.id)) { setNotice("Questo pasto e gia salvato."); return; }
    updateNutrition((current) => ({ ...current, savedMeals: [...current.savedMeals, parsed.data] }));
    setNotice("Pasto salvato: puoi riutilizzarlo senza cercare di nuovo gli alimenti.");
  }

  function confirmProfile(profile: BodyProfile, targets: MacroTargets) {
    if (nutrition.checkIns.length >= 365) { setNotice("Il registro contiene 365 rilevazioni: esporta i dati e rimuovi una rilevazione prima di aggiungerne altre."); return; }
    const checkIn = { id: crypto.randomUUID(), date: localDate(), createdAt: new Date().toISOString(), profile, targets };
    const parsed = nutritionStateSchema.safeParse({ ...nutrition, profile, targets, checkIns: [...nutrition.checkIns, checkIn] });
    if (!parsed.success) { setNotice("Profilo o obiettivi non validi: non sono stati applicati."); return; }
    updateNutrition((current) => ({ ...current, profile, targets, checkIns: [...current.checkIns, checkIn] }));
    setNotice("Profilo e obiettivi confermati da oggi. Il TDEE resta una stima; i pasti registrati non vengono modificati.");
  }

  function exportWorkspace() {
    try {
      const raw = writable ? JSON.stringify(workspace, null, 2) : localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error("Nessun archivio leggibile da esportare.");
      download(raw, `fit-diario-backup-${localDate()}.json`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Esportazione non riuscita."); }
  }

  async function importWorkspace(file: File) {
    setBusy(true);
    try {
      if (file.size > 2_000_000) throw new Error("L'archivio supera 2 MB.");
      const restored = localStateSchema.parse(JSON.parse(await file.text()));
      if (!window.confirm("Sostituire il diario, il profilo, la dieta e le ricette con questo archivio? Esporta prima la copia attuale. Con la sincronizzazione attiva, la sostituzione sara sincronizzata.")) return;
      localStorage.setItem(MIGRATION_KEY, "done");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(restored));
      setWorkspace(restored);
      setWritable(true);
      setStorageError("");
      setNotice("Archivio importato. Sono conservati anche i dati del precedente FIT Chef.");
    } catch (error) { setNotice(`Importazione non riuscita: ${error instanceof Error ? error.message : "file non valido"}. Nessun dato e stato sostituito.`); }
    finally { setBusy(false); }
  }

  async function resetLocal() {
    if (!window.confirm("Azzerare i dati su questo dispositivo e uscire da Google? La copia cloud non viene eliminata. Esporta prima il diario.")) return;
    setBusy(true);
    try {
      const client = getCloudClient();
      if (client) { await client.ready; await signOut(client.auth); }
      clearCloudBinding(localStorage);
      localStorage.setItem(MIGRATION_KEY, "done");
      const empty = initialWorkspace();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(empty));
      setWorkspace(empty);
      setWritable(true);
      setStorageError("");
      setNotice("Dispositivo azzerato. La copia cloud e ancora disponibile accedendo di nuovo.");
    } catch (error) { setNotice(`Ripristino non riuscito: ${error instanceof Error ? error.message : "errore del browser"}.`); }
    finally { setBusy(false); }
  }

  if (!ready) return <main id="main-content" className="nf-shell"><p role="status">Caricamento del tuo diario...</p></main>;

  return <div className="nf-app">
    <PwaRegistration/>
    <header className="nf-header">
      <a className="nf-brand" href="#main-content"><span className="nf-brand-icon"><Utensils size={22}/></span><span>FIT <strong>Diario</strong><small>Quello che mangi. Senza complicazioni.</small></span></a>
      <CloudAccount state={workspace} onRestore={setWorkspace} onMessage={setNotice} ready={ready && writable} disabled={!writable || busy} onBusyChange={setCloudBusy}/>
    </header>
    <nav className="nf-nav" aria-label="Sezioni dell'app">{tabs.map(({ id, title, icon: Icon }) =>
      <button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); setNotice(""); }}><Icon size={18}/>{title}</button>)}</nav>
    <main className="nf-shell" id="main-content">
      {notice && <div className="nf-alert nf-notice" role="status"><p>{notice}</p><button aria-label="Chiudi messaggio" onClick={() => setNotice("")}>×</button></div>}
      {store.error && <div className="nf-alert" role="alert">{store.error}</div>}
      {storageError && <div className="nf-alert" role="alert"><p>{storageError}</p><button onClick={exportWorkspace}>Esporta copia locale</button><button onClick={() => void resetLocal()}>Ripristina dispositivo</button></div>}
      <div className="nf-page-heading"><div><p className="nf-eyebrow">UN PASSO ALLA VOLTA</p><h1>{tab === "diary" ? "Il tuo diario alimentare" : tabs.find((entry) => entry.id === tab)?.title}</h1></div>
        <label className="nf-date nf-field">Data del diario<input type="date" required value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }}/></label>
      </div>
      <fieldset className="nf-workspace" disabled={!writable || busy || cloudBusy}>
        {tab === "diary" && <>
          {!nutrition.targets && <div className="nf-card nf-onboarding"><div><h2>Partiamo dal tuo obiettivo</h2><p>Puoi gia registrare i pasti. Per vedere le calorie rimanenti, calcola il TDEE e conferma i tuoi target.</p></div><button className="nf-button" onClick={() => setTab("profile")}>Imposta profilo e obiettivi</button></div>}
          <NutritionDiary entries={nutrition.entries} savedMeals={nutrition.savedMeals} date={date} onDate={setDate}
            targets={targetsOnDate(nutrition, date)} onAdd={addEntries} onSaveMeal={saveMeal}
            onUpdate={(entry) => {
              const parsed = diaryEntrySchema.safeParse(entry);
              if (!parsed.success || !nutrition.entries.some((item) => item.id === entry.id)) { setNotice("Modifica non valida: la voce del diario non e stata cambiata."); return; }
              updateNutrition((current) => ({ ...current, entries: current.entries.map((item) => item.id === entry.id ? parsed.data : item) }));
            }}
            onDelete={(id) => updateNutrition((current) => ({ ...current, entries: current.entries.filter((item) => item.id !== id) }))}
            onDeleteMeal={(id) => updateNutrition((current) => ({ ...current, savedMeals: current.savedMeals.filter((item) => item.id !== id) }))}/>
        </>}
        {tab === "profile" && <>
          <NutritionProfile profile={nutrition.profile} targets={nutrition.targets} onConfirm={confirmProfile}/>
          <section className="nf-card"><h2>Rilevazioni confermate</h2><p className="nf-muted">Il target del diario segue la rilevazione applicabile alla data scelta. Non aggiungiamo calorie per l&apos;attivita una seconda volta.</p>
            {!nutrition.checkIns.length && <p>Nessuna rilevazione salvata.</p>}
            <div className="nf-history">{[...nutrition.checkIns].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((entry) =>
              <div className="nf-food-row" key={entry.id}><strong>{entry.date}</strong><p>{entry.profile.weightKg} kg · {entry.targets.kcal} kcal · P {entry.targets.protein} g / C {entry.targets.carbs} g / G {entry.targets.fat} g</p>
                {entry.profile.bodyFatPercent !== null && <p className="nf-muted">Massa grassa: {entry.profile.bodyFatPercent}%</p>}
                {entry.profile.muscleMassKg != null && <p className="nf-muted">Massa muscolare: {entry.profile.muscleMassKg} kg</p>}
                {entry.id === latestCheckIn ? <p className="nf-muted">Rilevazione attiva: conferma nuovi parametri per aggiornarla.</p> : <button className="nf-text-button" onClick={() => {
                  if (!window.confirm("Eliminare questa rilevazione storica? Gli obiettivi attivi restano invariati, ma il riferimento delle date passate puo cambiare.")) return;
                  updateNutrition((current) => ({ ...current, checkIns: current.checkIns.filter((item) => item.id !== entry.id) }));
                }}>Elimina rilevazione</button>}
              </div>)}</div>
          </section>
        </>}
        {tab === "week" && <NutritionWeek date={date} state={workspace.weeklyDiet ?? initialWeeklyDietState()} onChange={(state) => setWorkspace((current) => ({ ...current, weeklyDiet: state }))} onAdd={addEntries}/>}
        {tab === "archive" && <section className="nf-card"><h2>Le ricette che avevi salvato</h2><p className="nf-muted">Non abbiamo eliminato il tuo lavoro precedente. Puoi registrare una porzione di una ricetta nel nuovo diario, senza generare immagini o chiamare servizi AI.</p>
          <label className="nf-field">Pasto per le ricette<select value={archiveMeal} onChange={(event) => setArchiveMeal(z.enum(["breakfast", "lunch", "snack", "dinner"]).parse(event.target.value))}>
            <option value="breakfast">Colazione</option><option value="lunch">Pranzo</option><option value="snack">Spuntino</option><option value="dinner">Cena</option>
          </select></label>
          {!workspace.recipes.length && <p>Nessuna ricetta in archivio su questo dispositivo.</p>}
          <div className="nf-grid">{workspace.recipes.map((recipe) => <article className="nf-food-row" key={recipe.id}><h3>{recipe.title}</h3><p>{recipe.description}</p><p>{recipe.nutritionPerServing.kcal} kcal per porzione · {recipe.servings} porzioni</p>
            <details><summary>Ingredienti e procedimento</summary>{recipe.ingredients.map((item) => <p key={item.ingredientId}>{item.name}: {item.grams} g totali ({item.state})</p>)}{recipe.steps.map((step) => <p key={step.id}><strong>{step.title}</strong> {step.instruction}</p>)}</details>
            <button className="nf-button" onClick={() => addEntries(recipe.ingredients.map((item) => ({
              id: crypto.randomUUID(), date, meal: archiveMeal, grams: item.grams / recipe.servings, createdAt: new Date().toISOString(),
              food: { id: `archive-${item.ingredientId}-${recipe.planHash.slice(0, 12)}`, name: item.name, state: item.state, source: "Snapshot nutrizionale della ricetta archiviata; valori generici stimati.",
                per100g: { kcal: item.nutrients.kcal * 100 / item.grams, protein: item.nutrients.protein * 100 / item.grams, carbs: item.nutrients.carbs * 100 / item.grams, fat: item.nutrients.fat * 100 / item.grams, fiber: item.nutrients.fiber * 100 / item.grams } },
            })))}>Registra una porzione</button>
          </article>)}</div>
        </section>}
      </fieldset>
      <footer className="nf-footer"><p>Stime nutrizionali e TDEE non sono prescrizioni mediche. Nessun servizio AI a pagamento; riconoscimento del cibo da foto non attivo.</p>
        <div className="nf-footer-actions"><button className="nf-text-button" onClick={exportWorkspace}><Download size={16}/>Esporta tutti i dati</button><label className="nf-field">Importa archivio completo<input type="file" accept=".json,application/json" disabled={busy || cloudBusy} onChange={(event) => {
          const file = event.target.files?.[0]; if (file) void importWorkspace(file); event.target.value = "";
        }}/></label><button className="nf-text-button" disabled={busy || cloudBusy} onClick={() => void resetLocal()}>Azzera solo questo dispositivo</button></div>
      </footer>
    </main>
  </div>;
}
