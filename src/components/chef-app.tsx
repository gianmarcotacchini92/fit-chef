"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { signOut } from "firebase/auth";
import {
  ArrowDown, ArrowRight, BookOpen, CalendarDays, ChefHat, Check, CheckCheck, ChevronDown, Clock3,
  Dumbbell, Flame, Heart, History, Info, Leaf, LoaderCircle, LockKeyhole, Plus,
  Refrigerator, Search, Settings2, ShieldCheck, Sparkles, Sprout, Trash2,
  Utensils, WandSparkles, X,
} from "lucide-react";
import { ALLERGENS, DEFAULT_INPUT, DEFAULT_MEAL_INPUT, EQUIPMENT_LABELS, NUTRIENT_LABELS } from "@/lib/defaults";
import { CATALOG_VERSION, INGREDIENTS, getIngredient } from "@/lib/catalog";
import { applyDietItems, formatNumber, normalizeFoodName, parseDiet, retainRecipes } from "@/lib/pantry";
import { localStateSchema, recipeSchema } from "@/lib/validation";
import { confirmChefExtras, getChefExtraProposal, mealGenerationInput, type ChefExtraProposal as ChefProposal } from "@/lib/meal";
import { getCloudClient } from "@/lib/cloud";
import { clearCloudBinding } from "@/lib/cloud-storage";
import { selectGenerationHistory } from "@/lib/recipe-history";
import { applyWeeklyMeal, initialWeeklyDietState, weeklyMealIsApplied, weeklyMealKey } from "@/lib/weekly-diet";
import type { Equipment, GenerateRequest, GenerationResponse, LocalState, PantryItem, Preferences, Recipe, RecipeInput, Targets, VariantRequest } from "@/lib/types";
import { FoodArt } from "./food-art";
import { RecipeView } from "./recipe-view";
import { CloudAccount } from "./cloud-account";
import { MealComposer } from "./meal-composer";
import { WeeklyDiet } from "./weekly-diet";
import { PwaRegistration } from "./pwa-registration";
import { ChefExtraProposal } from "./chef-extra-proposal";

const STORAGE_KEY = "fit-chef.workspace.v1";
const LOCAL_PLAN_MIGRATION_KEY = "fit-chef.local-plan-migration.v1";
const STATIC_SITE = process.env.NEXT_PUBLIC_FIT_STATIC === "true";
const configSchema = z.object({
  aiTextAvailable: z.boolean(),
  aiImagesAvailable: z.boolean(),
  catalogVersion: z.string(),
  storageMode: z.string(),
});
const generationSchema = z.union([
  z.object({ status: z.literal("ok"), recipe: recipeSchema }),
  z.object({ status: z.enum(["needs_input", "infeasible", "error"]), message: z.string(), details: z.array(z.string()) }),
]);
const imageResponseSchema = z.union([
  z.object({ status: z.literal("ok"), image: z.object({ url: z.string(), kind: z.literal("ai"), planHash: z.string() }) }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);

function newWorkspace(): LocalState {
  return { version: 1, input: structuredClone(DEFAULT_MEAL_INPUT), recipes: [], favoriteIds: [], cookedIds: [], weeklyDiet: initialWeeklyDietState(), builderMode: "weekly" };
}

type View = "create" | "favorites" | "history" | "recipe";

export function ChefApp() {
  const [workspace, setWorkspace] = useState<LocalState>(newWorkspace);
  const [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [storageWritable, setStorageWritable] = useState(true);
  const [view, setView] = useState<View>("create");
  const builderMode = workspace.builderMode ?? "weekly";
  const setBuilderMode = (mode: "weekly" | "meal" | "pantry") => setWorkspace((current) => ({ ...current, builderMode: mode }));
  const [mealPending, setMealPending] = useState(false);
  const [mealEditorVersion, setMealEditorVersion] = useState(0);
  const [manualInitialText, setManualInitialText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [generationError, setGenerationError] = useState<{ message: string; details: string[] } | null>(null);
  const [config, setConfig] = useState<z.infer<typeof configSchema> | null>(() => STATIC_SITE
    ? { aiTextAvailable: false, aiImagesAvailable: false, catalogVersion: CATALOG_VERSION, storageMode: "browser" }
    : null);
  const [aiConsent, setAiConsent] = useState(false);
  const [dietText, setDietText] = useState("");
  const [dietConfirmed, setDietConfirmed] = useState(false);
  const [dietErrors, setDietErrors] = useState<string[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [extraPrompt, setExtraPrompt] = useState<{ input: RecipeInput; proposal: ChefProposal } | null>(null);
  const generationLock = useRef(false);
  const imageLock = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const infoRef = useRef<HTMLDialogElement>(null);
  const extraPromptRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function hydrateWorkspace() {
      let loaded = newWorkspace();
      let writable = true;
      let failure = "";
      let migrationNotice = "";
      let planMigrationDone = false;
      try {
        planMigrationDone = localStorage.getItem(LOCAL_PLAN_MIGRATION_KEY) === "done";
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = localStateSchema.safeParse(JSON.parse(raw));
          if (parsed.success) loaded = parsed.data;
          else {
            failure = "I dati locali non sono compatibili con questa versione. Non verranno sovrascritti: puoi esportarli o ripartire.";
            writable = false;
          }
        }
      } catch (error) {
        failure = `Impossibile leggere i dati locali: ${error instanceof Error ? error.message : "errore del browser"}.`;
        writable = false;
      }
      if (writable && !STATIC_SITE && !planMigrationDone && !loaded.weeklyDiet?.plan) {
        try {
          const response = await fetch("/api/weekly-diet", {
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
          });
          if (!response.ok) throw new Error("Il server non ha reso disponibile il piano privato.");
          const data = z.strictObject({ plan: z.record(z.string(), z.unknown()).nullable() }).parse(await response.json());
          if (data.plan !== null) {
            loaded = localStateSchema.parse({
              ...loaded,
              weeklyDiet: { ...(loaded.weeklyDiet ?? initialWeeklyDietState()), plan: data.plan },
            });
            if (controller.signal.aborted) return;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
            localStorage.setItem(LOCAL_PLAN_MIGRATION_KEY, "done");
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          migrationNotice = `Piano locale non importato: ${error instanceof Error ? error.message : "errore di lettura"}. I dati esistenti sono conservati; riprova ricaricando o importa il piano dal calendario.`;
        }
      }
      if (controller.signal.aborted) return;
      setWorkspace(loaded);
      setStorageWritable(writable);
      setStorageError(failure);
      if (migrationNotice) setNotice(migrationNotice);
      setHydrated(true);
    }
    void hydrateWorkspace();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!hydrated || !storageWritable) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch (error) {
      // Storage failures must remain visible; the in-memory workspace stays available.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageError(`Salvataggio sul dispositivo non riuscito: ${error instanceof Error ? error.message : "spazio esaurito"}. Esporta i dati per conservarli.`);
      setStorageWritable(false);
    }
  }, [workspace, hydrated, storageWritable]);

  useEffect(() => {
    if (STATIC_SITE) return;
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Configurazione del server non disponibile.");
        const data = configSchema.parse(await response.json());
        setConfig(data);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setNotice(error instanceof Error ? error.message : "Impossibile caricare la configurazione.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (infoOpen) infoRef.current?.showModal();
    else infoRef.current?.close();
  }, [infoOpen]);

  useEffect(() => {
    if (extraPrompt) extraPromptRef.current?.showModal();
    else extraPromptRef.current?.close();
  }, [extraPrompt]);

  const input = workspace.input;
  const weeklyDiet = workspace.weeklyDiet ?? initialWeeklyDietState();
  const weeklyApplied = weeklyMealIsApplied(weeklyDiet, input);
  const currentRecipe = workspace.recipes.find((recipe) => recipe.id === selectedId);
  const setInput = useCallback((change: RecipeInput | ((current: RecipeInput) => RecipeInput)) => {
    setWorkspace((current) => ({ ...current, input: typeof change === "function" ? change(current.input) : change }));
    setManualInitialText("");
  }, []);
  const setPreference = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setInput((current) => ({ ...current, preferences: { ...current.preferences, [key]: value } }));
  const setTarget = (key: keyof Omit<Targets, "strictCalories">, value: string) =>
    setInput((current) => ({ ...current, targets: { ...current.targets, [key]: value === "" ? null : Number(value) } }));
  const updatePantry = (id: string, change: Partial<PantryItem>) =>
    setInput((current) => ({ ...current, pantry: current.pantry.map((item) => item.ingredientId === id ? { ...item, ...change } : item) }));

  function addIngredient(id: string) {
    const food = getIngredient(id);
    if (!food || input.pantry.some((item) => item.ingredientId === id)) return;
    setInput((current) => ({ ...current, pantry: [...current.pantry, { ingredientId: id, availableGrams: food.defaultGrams, mode: "available" }] }));
    setQuery("");
    searchRef.current?.focus();
  }

  function navigate(next: View) {
    setView(next);
    setGenerationError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function switchBuilder(mode: "weekly" | "meal" | "pantry") {
    setBuilderMode(mode);
    setGenerationError(null);
    if (mode === "pantry" && input.pantry.length === 0) {
      setInput({ ...structuredClone(DEFAULT_INPUT), preferences: structuredClone(input.preferences) });
      setNotice("Modalita frigo: abbiamo caricato ingredienti d'esempio. Conferma le disponibilita reali prima di generare.");
    }
  }

  function confirmWeeklyMeal(): string[] {
    const result = applyWeeklyMeal(weeklyDiet, input);
    if (!result.input) return result.errors;
    if (input.pantry.length > 0 && !window.confirm("Caricare questo pasto della settimana al posto degli alimenti attuali? Le aggiunte andranno riconfermate; storico, preferiti e gli altri giorni restano invariati.")) return [];
    const confirmedInput = result.input;
    setWorkspace((current) => ({
      ...current, input: confirmedInput,
      weeklyDiet: { ...weeklyDiet, appliedKey: weeklyMealKey(weeklyDiet.day, weeklyDiet.meal) },
    }));
    setMealEditorVersion((current) => current + 1);
    setMealPending(false);
    setGenerationError(null);
    return [];
  }

  function customizeWeeklyMeal() {
    const plan = weeklyDiet.plan?.[weeklyDiet.day][weeklyDiet.meal];
    if (!plan) {
      switchBuilder("meal");
      return;
    }
    if (!weeklyApplied && input.pantry.length > 0 && !window.confirm("Aprire un pasto manuale senza riutilizzare gli alimenti del pasto precedente? Storico, preferiti e dieta settimanale rimangono invariati.")) return;
    setManualInitialText(!weeklyApplied && !plan.freeChoice ? plan.original : "");
    setWorkspace((current) => ({
      ...current, builderMode: "meal",
      input: {
        ...current.input, pantry: weeklyApplied ? current.input.pantry : [],
        preferences: { ...current.input.preferences, meal: weeklyDiet.meal, taste: plan.taste },
      },
    }));
    setMealEditorVersion((current) => current + 1);
    setGenerationError(null);
    setNotice(plan.freeChoice ? `${plan.original}: scegli alimenti e quantita nel compositore. Non e stato assegnato un target calorico automatico.`
      : "Modifica manuale: le modifiche riguardano questo pasto, non riscrivono il piano settimanale originale.");
  }

  function showRecipe(recipe: Recipe) {
    setSelectedId(recipe.id);
    navigate("recipe");
  }

  async function generate(override?: RecipeInput, variant?: VariantRequest, extrasReviewed = false) {
    if (generationLock.current || cloudBusy) return;
    const nextInput = extrasReviewed || (!override && builderMode !== "pantry")
      ? mealGenerationInput(override ?? input) : override ?? input;
    if (!override && builderMode === "weekly" && !weeklyApplied) {
      setGenerationError({ message: "Conferma prima il pasto della settimana.", details: ["Scegli giorno e pasto, completa i pesi mancanti e conferma i prodotti e le alternative."] });
      return;
    }
    if (!override && builderMode !== "pantry") {
      if (mealPending) {
        setGenerationError({ message: "Conferma prima le modifiche al pasto.", details: ["Premi 'Usa questo pasto', completa le quantita o annulla la selezione non ancora aggiunta."] });
        return;
      }
      if (!nextInput.pantry.some((item) => item.mode === "fixed")) {
        setGenerationError({ message: "Quale pasto vuoi trasformare?", details: ["Inserisci gli alimenti della dieta con i grammi per porzione. Le eventuali aggiunte si confermano dopo."] });
        return;
      }
    }
    if (nextInput.pantry.length < 1) {
      setGenerationError({ message: "Il frigo e ancora vuoto.", details: ["Aggiungi almeno un ingrediente con la quantita disponibile."] });
      return;
    }
    if (!override && !extrasReviewed && builderMode !== "pantry" && !nextInput.pantry.some((item) => item.mode === "preferred")) {
      const proposal = getChefExtraProposal(nextInput);
      if (proposal) {
        setExtraPrompt({ input: structuredClone(input), proposal });
        return;
      }
    }
    generationLock.current = true;
    setBusy(true);
    setGenerationError(null);
    const nonce = crypto.randomUUID();
    try {
      const request: GenerateRequest = {
        ...nextInput, nonce, history: selectGenerationHistory(workspace.recipes, nextInput),
        ...(variant ? { variant } : {}),
      };
      let result: GenerationResponse;
      if (STATIC_SITE) {
        const { browserGenerateRecipe } = await import("@/lib/browser-generation");
        result = generationSchema.parse(await browserGenerateRecipe(request));
      } else {
        const response = await fetch("/api/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": nonce, "x-fit-ai-consent": String(aiConsent) },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(90000),
        });
        const parsed = generationSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Il server ha restituito una risposta non valida. La ricetta non e stata salvata.");
        if (!response.ok && parsed.data.status === "ok") throw new Error("La generazione non e stata completata correttamente.");
        result = parsed.data;
      }
      if (result.status !== "ok") {
        setGenerationError({ message: result.message, details: result.details });
        return;
      }
      const recipeNotices: string[] = [];
      if (builderMode !== "pantry") {
        const unused = nextInput.pantry.filter((item) => item.mode === "preferred"
          && !result.recipe.ingredients.some((used) => used.ingredientId === item.ingredientId));
        if (unused.length) recipeNotices.push(`Questa variante non usa ${unused.map((item) => getIngredient(item.ingredientId)?.name ?? item.ingredientId).join(", ")}. Queste aggiunte non sono conteggiate nei macros e restano disponibili per un'altra versione.`);
      }
      if (variant?.kind === "another" && result.recipe.id === variant.baselineRecipeId) recipeNotices.push(result.recipe.variantTip);
      if (recipeNotices.length) setNotice(recipeNotices.join(" "));
      setWorkspace((current) => {
        const recipes = retainRecipes([result.recipe, ...current.recipes.filter((recipe) => recipe.id !== result.recipe.id)], current.favoriteIds);
        const retainedIds = new Set(recipes.map((recipe) => recipe.id));
        return { ...current, input: override ?? current.input, recipes, cookedIds: current.cookedIds.filter((id) => retainedIds.has(id)) };
      });
      setSelectedId(result.recipe.id);
      setView("recipe");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setGenerationError({ message: "Non sono riuscito a completare la ricetta.", details: [error instanceof Error ? error.message : "Errore di connessione. Riprova."] });
    } finally {
      setBusy(false);
      generationLock.current = false;
    }
  }

  function toggleFavorite(recipeId: string) {
    if (cloudBusy) {
      setNotice("Attendi il completamento della sincronizzazione prima di modificare i preferiti.");
      return;
    }
    if (!workspace.favoriteIds.includes(recipeId) && workspace.favoriteIds.length >= 50) {
      setNotice("Puoi conservare fino a 50 preferiti in questa versione. Rimuovine uno per salvarne un altro.");
      return;
    }
    setWorkspace((current) => ({ ...current, favoriteIds: current.favoriteIds.includes(recipeId) ? current.favoriteIds.filter((id) => id !== recipeId) : [...current.favoriteIds, recipeId] }));
  }

  function requestVariant(kind: VariantRequest["kind"]) {
    if (!currentRecipe || busy) return;
    const next = structuredClone(currentRecipe.input);
    if (kind === "protein") {
      const target = Math.ceil(currentRecipe.nutritionPerServing.protein * 1.1);
      if (!window.confirm(`Cerco almeno ${target} g di proteine per porzione. Gli altri target e le grammature bloccate rimangono validi. Procedere?`)) return;
      next.targets.protein = target;
    }
    if (kind === "lighter") {
      const target = Math.floor(currentRecipe.nutritionPerServing.kcal * .9);
      if (!window.confirm(`Cerco una ricetta da non piu di ${target} kcal per porzione, senza ridurre il numero di porzioni. Mantengo gli altri vincoli. Procedere?`)) return;
      next.targets.kcal = target;
      next.targets.strictCalories = true;
    }
    if (kind === "faster") next.preferences.maxTime = Math.max(1, currentRecipe.minutes - 5);
    if (kind === "sweet") {
      if (!window.confirm("Cerco un dessert con gli stessi ingredienti e target. Gli alimenti bloccati rimangono obbligatori: se non sono compatibili, te lo segnalo. Procedere?")) return;
      next.preferences.taste = "sweet";
      next.preferences.meal = "dessert";
    }
    void generate(next, { kind, baselineNutrition: currentRecipe.nutritionPerServing, baselineMinutes: currentRecipe.minutes, baselineRecipeId: currentRecipe.id });
  }

  function stageSubstitution(ingredientId: string, replacementId: string) {
    if (!currentRecipe) return;
    const replacement = getIngredient(replacementId);
    if (!replacement) return;
    const original = currentRecipe.input.pantry.find((item) => item.ingredientId === ingredientId);
    if (!window.confirm(`Sostituisco ${getIngredient(ingredientId)?.name} con ${replacement.name}. ${original?.mode === "fixed" ? "Mantengo i grammi per porzione, ma non e un'equivalenza nutrizionale." : "La nuova disponibilita va confermata."} Controlla alimento e quantita prima di creare la nuova ricetta.`)) return;
    const next = structuredClone(currentRecipe.input);
    next.pantry = next.pantry.filter((item) => item.ingredientId !== ingredientId);
    const existing = next.pantry.find((item) => item.ingredientId === replacementId);
    if (original?.mode === "fixed" && original.dietGrams) {
      const dietGrams = original.dietGrams + (existing?.mode === "fixed" ? existing.dietGrams ?? 0 : 0);
      next.pantry = next.pantry.filter((item) => item.ingredientId !== replacementId);
      next.pantry.push({ ingredientId: replacementId, mode: "fixed", dietGrams, availableGrams: Math.max(existing?.availableGrams ?? 0, dietGrams * next.preferences.servings) });
    } else if (!existing) {
      next.pantry.push({ ingredientId: replacementId, availableGrams: replacement.defaultGrams, mode: "available" });
    }
    setInput(next);
    setBuilderMode(next.pantry.some((item) => item.mode === "fixed") ? "meal" : "pantry");
    navigate("create");
    setNotice(`Sostituzione preparata. Conferma la disponibilita reale di ${replacement.name} e crea una nuova ricetta.`);
  }

  async function generateImage() {
    if (!currentRecipe || imageLock.current || cloudBusy) return;
    if (!aiConsent) {
      setNotice("Per generare un'immagine, abilita prima il consenso AI nella schermata di creazione.");
      return;
    }
    imageLock.current = true;
    setImageBusy(true);
    const recipeId = currentRecipe.id;
    try {
      const response = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-fit-ai-consent": "true" },
        body: JSON.stringify({ recipeId, planHash: currentRecipe.planHash }),
        signal: AbortSignal.timeout(150000),
      });
      const parsed = imageResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Risposta del servizio immagini non valida.");
      if (parsed.data.status !== "ok") throw new Error(parsed.data.message);
      const image = parsed.data.image;
      if (image.planHash !== currentRecipe.planHash) throw new Error("L'immagine non corrisponde a questa versione della ricetta.");
      setWorkspace((current) => ({ ...current, recipes: current.recipes.map((recipe) => recipe.id === recipeId ? { ...recipe, image } : recipe) }));
    } catch (error) {
      setNotice(`Immagine non disponibile: ${error instanceof Error ? error.message : "errore del servizio"}. La ricetta rimane utilizzabile.`);
    } finally {
      setImageBusy(false);
      imageLock.current = false;
    }
  }

  function importDiet() {
    const result = parseDiet(dietText, INGREDIENTS);
    if (!dietConfirmed) result.errors.push("Conferma di avere le quantita indicate per tutte le porzioni.");
    if (result.errors.length) {
      setDietErrors(result.errors);
      return;
    }
    if (result.items.some((item) => item.ingredientId === "cream-cheese") && !window.confirm("Il formaggio spalmabile usa valori generici per la versione classica, non i valori ufficiali Philadelphia. Confermi che il prodotto corrisponde, dopo aver confrontato l'etichetta?")) return;
    setInput((current) => ({ ...current, pantry: applyDietItems(current.pantry, result.items, current.preferences.servings) }));
    setDietErrors([]);
    setDietText("");
    setDietConfirmed(false);
    setNotice("Alimenti della dieta importati. Le grammature sono bloccate per porzione; puoi modificarle nel frigo.");
  }

  function loadBreakfast() {
    if (input.pantry.length && !window.confirm("Sostituire il frigo corrente con ingredienti d'esempio per una colazione dolce? Storico e preferiti rimangono salvati.")) return;
    if (builderMode !== "pantry") {
      setBuilderMode("meal");
      setManualInitialText("");
      const next = structuredClone(input);
      next.pantry = [
        { ingredientId: "greek-yogurt", availableGrams: 170 * next.preferences.servings, mode: "fixed", dietGrams: 170 },
        { ingredientId: "banana", availableGrams: 100 * next.preferences.servings, mode: "fixed", dietGrams: 100 },
      ];
      next.preferences.taste = "sweet";
      next.preferences.meal = "breakfast";
      setInput(next);
      setMealEditorVersion((current) => current + 1);
      setNotice("Colazione d'esempio: yogurt e banana con grammature fisse. Scegli tu quali piccole aggiunte confermare.");
      return;
    }
    const next = { ...structuredClone(DEFAULT_INPUT), preferences: structuredClone(input.preferences) };
    next.pantry = ["oats", "eggs", "greek-yogurt", "banana", "peanut-butter"].flatMap((id) => {
      const ingredient = getIngredient(id);
      return ingredient ? [{ ingredientId: id, availableGrams: ingredient.defaultGrams, mode: "available" as const }] : [];
    });
    next.preferences.taste = "sweet";
    next.preferences.meal = "breakfast";
    next.targets = { kcal: 400, protein: 30, carbs: 40, fat: 12, fiber: null, strictCalories: false };
    setInput(next);
    setNotice("Colazione d'esempio caricata. Controlla le disponibilita: i target sono esempi modificabili, non una prescrizione.");
  }

  function exportData() {
    try {
      const raw = storageError ? localStorage.getItem(STORAGE_KEY) ?? JSON.stringify(workspace) : JSON.stringify(workspace, null, 2);
      const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "fit-chef-dati.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setNotice(`Esportazione non riuscita: ${error instanceof Error ? error.message : "errore del browser"}.`);
    }
  }

  async function clearData() {
    if (generationLock.current || imageLock.current || cloudBusy) {
      setNotice("Attendi la fine della generazione o sincronizzazione prima di eliminare i dati, per evitare che il risultato li ripristini.");
      return;
    }
    if (!window.confirm("Eliminare il workspace di questo dispositivo, compresi piano settimanale, frigo, storico e preferiti? Verrai disconnesso da Google per non cancellare i dati cloud. Le copie di sicurezza separate e i file esportati rimangono disponibili.")) return;
    setCloudBusy(true);
    try {
      const client = getCloudClient();
      if (client) {
        await client.ready;
        if (client.auth.currentUser) await signOut(client.auth);
      }
      clearCloudBinding(localStorage);
      localStorage.setItem(LOCAL_PLAN_MIGRATION_KEY, "done");
      localStorage.removeItem(STORAGE_KEY);
      setWorkspace(newWorkspace());
      setStorageWritable(true);
      setStorageError("");
      setSelectedId(null);
      navigate("create");
      setInfoOpen(false);
      setBuilderMode("weekly");
      setManualInitialText("");
      setMealPending(false);
      setMealEditorVersion((current) => current + 1);
      setNotice("Workspace locale eliminato e account scollegato. Il cloud, le copie di sicurezza separate e i file esportati sono conservati. Il piano non verra reimportato automaticamente.");
    } catch (error) {
      setNotice(`Eliminazione non riuscita: ${error instanceof Error ? error.message : "errore del browser"}.`);
    } finally { setCloudBusy(false); }
  }

  const matches = INGREDIENTS.filter((food) => !input.pantry.some((item) => item.ingredientId === food.id))
    .filter((food) => category === "all" || food.category === category)
    .filter((food) => [food.name, ...food.aliases].some((name) => normalizeFoodName(name).includes(normalizeFoodName(query))));
  const visibleRecipes = view === "favorites" ? workspace.recipes.filter((recipe) => workspace.favoriteIds.includes(recipe.id)) : workspace.recipes;

  if (!hydrated) return <main className="main-content"><div className="notice" role="status"><LoaderCircle size={20}/><p>Caricamento dei tuoi dati FIT Chef...</p></div></main>;

  return (
    <div className="app-shell">
      <PwaRegistration/>
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("create")} aria-label="FIT Chef, home"><span className="brand-mark"><ChefHat size={27}/></span><span>fit<span className="brand-light">chef</span><span className="brand-dot">.</span></span></button>
        <div className="sidebar-caption">IL TUO SPAZIO</div>
        <nav className="main-nav" aria-label="Navigazione principale">
          <button className={view === "create" || view === "recipe" ? "active" : ""} onClick={() => navigate("create")}><Sparkles size={19}/>Crea una ricetta<span className="nav-indicator"/></button>
          <button onClick={() => { navigate("create"); setBuilderMode("weekly"); setTimeout(() => document.getElementById("weekly-diet")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}><CalendarDays size={19}/>La mia settimana<span className="nav-count">7</span></button>
          <button className={view === "favorites" ? "active" : ""} onClick={() => navigate("favorites")}><Heart size={19}/>Le mie ricette<span className="nav-count">{workspace.favoriteIds.length}</span></button>
          <button className={view === "history" ? "active" : ""} onClick={() => navigate("history")}><History size={19}/>Gia create</button>
        </nav>
        <div className="sidebar-tip"><div className="tip-icon"><Sprout size={22}/></div><strong>Buono da mangiare.<br/>Pensato per te.</strong><p>I tuoi ingredienti, un po&apos; di creativita e numeri trasparenti.</p><button onClick={() => setInfoOpen(true)}>Come funziona <ArrowRight size={15}/></button></div>
        <div className="sidebar-bottom"><span className="online-dot"/><span>Il tuo chef e pronto</span><span className="version-label">MVP</span></div>
      </aside>

      <div className="main-shell">
        <header className="topbar"><div className="breadcrumb"><span>Il tuo spazio</span><span>/</span><strong>{view === "favorites" ? "Le mie ricette" : view === "history" ? "Gia create" : view === "recipe" ? "La tua ricetta" : "Crea una ricetta"}</strong></div>
          <div className="topbar-actions"><span className="local-status"><ShieldCheck size={15}/>{storageWritable ? "Salvato sul dispositivo" : "Salvataggio sospeso"}</span>
            <CloudAccount state={workspace} ready={hydrated && storageWritable} disabled={busy || imageBusy || mealPending || cloudBusy || Boolean(extraPrompt)} onBusyChange={setCloudBusy} onRestore={(restored) => {
              const inputChanged = JSON.stringify(restored.input) !== JSON.stringify(workspace.input);
              localStorage.setItem(LOCAL_PLAN_MIGRATION_KEY, "done");
              setWorkspace(restored);
              setStorageWritable(true);
              setStorageError("");
              if (selectedId && !restored.recipes.some((recipe) => recipe.id === selectedId)) { setSelectedId(null); navigate("create"); }
              if (inputChanged) { setManualInitialText(""); setMealPending(false); setMealEditorVersion((current) => current + 1); }
            }} onMessage={setNotice}/>
          </div>
        </header>

        <main className="main-content" id="main-content">
          {notice && <div className="notice dismissible" role="status"><Info size={18}/><p>{notice}</p><button className="icon-button" aria-label="Chiudi messaggio" onClick={() => setNotice("")}><X size={16}/></button></div>}
          {storageError && <div className="notice warning-notice"><p>{storageError}</p><div className="button-row"><button className="text-button" onClick={exportData}>Esporta dati</button><button className="text-button" onClick={clearData}>Riparti da zero</button></div></div>}
          {generationError && <div className="notice error-notice" role="alert"><strong>{generationError.message}</strong>{generationError.details.map((detail, index) => <p key={index}>{detail}</p>)}<button className="text-button" onClick={() => { setGenerationError(null); if (view === "recipe") navigate("create"); }}>Modifica i vincoli <ArrowRight size={14}/></button></div>}

          {view === "create" && <>
            <section className="hero">
              <div className="hero-copy"><span className="eyebrow"><span className="tiny-spark">✦</span> IL TUO PERSONAL CHEF, IN VERSIONE FIT</span>
                <h1>Il tuo pasto.<br/>Tutto un altro<br/><em>sapore.</em></h1>
                <p>{weeklyDiet.plan ? "La tua settimana e gia qui." : "Porta qui il tuo pasto o importa la tua settimana."}<br className="desktop-break"/> Scegli il pasto della dieta: lo trasformiamo in una ricetta che hai voglia di mangiare.</p>
                <div className="hero-benefits"><span><Check size={14}/> Quantita rispettate</span><span><Check size={14}/> Aggiunte scelte da te</span><span><Check size={14}/> Macros trasparenti</span></div>
                <button className="hero-link" onClick={() => document.getElementById(builderMode === "weekly" ? "weekly-diet" : builderMode === "meal" ? "meal-builder" : "fridge")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Scegli il tuo pasto <ArrowDown size={16}/></button>
              </div>
              <div className="hero-art"><FoodArt/><div className="hero-sticker"><span className="sticker-icon"><Flame size={19}/></span><div><strong>Buono da non crederci.</strong><span>Pensato anche nei numeri.</span></div></div><div className="art-label"><Sparkles size={12}/> ISPIRAZIONE, NON UNA RICETTA GENERATA</div></div>
            </section>

            <div className="workflow-heading"><div><h2>Una settimana, tutto un altro gusto.</h2><p>Colazione, pranzo, spuntino o cena. Le tue quantita, una nuova idea.</p></div><span className="quiet-pill"><Clock3 size={13}/> Un pasto alla volta</span></div>
            <div className="builder-switch" aria-label="Modalita di creazione">
              <button className={builderMode === "weekly" ? "active" : ""} aria-pressed={builderMode === "weekly"} disabled={busy || cloudBusy} onClick={() => switchBuilder("weekly")}><CalendarDays size={16}/>Dalla mia settimana</button>
              <button className={builderMode === "meal" ? "active" : ""} aria-pressed={builderMode === "meal"} disabled={busy || cloudBusy} onClick={() => switchBuilder("meal")}><Utensils size={16}/>Dal mio pasto</button>
              <button className={builderMode === "pantry" ? "active" : ""} aria-pressed={builderMode === "pantry"} disabled={busy || cloudBusy} onClick={() => switchBuilder("pantry")}><Refrigerator size={16}/>Dal frigo</button>
            </div>
            <fieldset className="workspace-grid" disabled={busy || cloudBusy} aria-busy={busy || cloudBusy} aria-label="Configura la tua ricetta">
              <div className="workspace-left">
                {builderMode === "weekly" && <WeeklyDiet state={weeklyDiet} input={input}
                  onChange={(state) => { setWorkspace((current) => ({ ...current, weeklyDiet: state })); setGenerationError(null); }}
                  onApply={confirmWeeklyMeal} onManual={customizeWeeklyMeal} onMaxTime={(minutes) => setPreference("maxTime", minutes)}/>}
                {builderMode !== "pantry" ? (builderMode === "meal" || weeklyApplied) && <MealComposer key={`${builderMode}-${mealEditorVersion}`} input={input} onChange={setInput} onPendingChange={setMealPending} initialText={builderMode === "meal" ? manualInitialText : ""} lockedBase={builderMode === "weekly"}/> : <section className="card fridge-card" id="fridge">
                  <div className="section-heading"><div className="heading-with-step"><span className="section-step">01</span><div><h2>Cosa hai in frigo?</h2><p>Aggiungi gli ingredienti e le quantita disponibili.</p></div></div><Refrigerator className="section-icon" size={22}/></div>
                  <div className="example-note"><Info size={14}/><span>{workspace.recipes.length === 0 ? "Un frigo d'esempio per iniziare. Adattalo a quello che hai davvero." : "Le quantita sono totali, anche quando prepari piu porzioni."}</span></div>
                  <div className="ingredient-search"><Search size={19}/><input ref={searchRef} aria-label="Cerca ingredienti" placeholder="Cerca un ingrediente... pollo, avena, yogurt" value={query} onFocus={() => setCatalogOpen(true)} onChange={(event) => { setQuery(event.target.value); setCatalogOpen(true); }} onKeyDown={(event) => {
                    if (event.key === "Enter" && matches.length === 1) { event.preventDefault(); addIngredient(matches[0].id); }
                    if (event.key === "Escape") setCatalogOpen(false);
                  }}/><button className="icon-button" aria-label={catalogOpen ? "Chiudi catalogo" : "Apri catalogo"} onClick={() => setCatalogOpen(!catalogOpen)}>{catalogOpen ? <X size={17}/> : <Plus size={18}/>}</button></div>
                  {catalogOpen && <div className="catalog-picker">
                    <div className="catalog-categories">{[["all", "Tutti"], ["protein", "Proteine"], ["carb", "Cereali"], ["vegetable", "Verdure"], ["fruit", "Frutta"], ["dairy", "Latticini"], ["fat", "Grassi"], ["pantry", "Dispensa"]].map(([id, label]) => <button key={id} className={category === id ? "active" : ""} onClick={() => setCategory(id)}>{label}</button>)}</div>
                    <div className="catalog-results">{matches.slice(0, 18).map((food) => <button key={food.id} className="catalog-item" onClick={() => addIngredient(food.id)} disabled={input.pantry.length >= 60}><span>{food.emoji}</span><div><strong>{food.name}</strong><small>{food.state}</small></div><Plus size={16}/></button>)}</div>
                    {matches.length === 0 && <p className="empty-search">Nessuna corrispondenza. Prova un nome diverso o controlla gli ingredienti gia aggiunti. Non inventiamo i valori dei prodotti sconosciuti.</p>}
                    <p className="catalog-count">{INGREDIENTS.length} alimenti nel catalogo iniziale · Valori medi per 100 g</p>
                  </div>}
                  <div className="fridge-list">{input.pantry.length === 0 && <div className="empty-fridge"><Refrigerator size={32}/><h3>Spazio alle tue idee.</h3><p>Cerca il primo ingrediente qui sopra.</p></div>}
                    {input.pantry.map((item) => {
                      const food = getIngredient(item.ingredientId);
                      if (!food) return <div className="notice error-notice" key={item.ingredientId}>Alimento non piu presente nel catalogo: {item.ingredientId}. <button onClick={() => setInput((current) => ({ ...current, pantry: current.pantry.filter((entry) => entry.ingredientId !== item.ingredientId) }))}>Rimuovi</button></div>;
                      const excluded = input.preferences.excludedIngredientIds.includes(food.id) || food.allergens.some((allergen) => input.preferences.allergens.includes(allergen)) || (input.preferences.vegetarian && !food.vegetarian);
                      return <div key={item.ingredientId} className={`fridge-item ${item.mode === "fixed" ? "fridge-item-locked" : ""} ${excluded ? "fridge-item-excluded" : ""}`}>
                        <div className="fridge-item-main"><span className="ingredient-emoji">{food.emoji}</span><div className="ingredient-name"><strong>{food.name}{item.mode === "fixed" && <LockKeyhole size={12}/>}</strong><span>{excluded ? "Escluso dalle tue preferenze" : food.state}</span></div>
                          <label className="quantity-input"><input aria-label={`Quantita disponibile ${food.name}`} type="number" min="0" max="10000" step="0.1" value={item.availableGrams} onChange={(event) => updatePantry(item.ingredientId, { availableGrams: Number(event.target.value) })}/><span>g</span></label>
                          <button className="icon-button remove-ingredient" aria-label={`Rimuovi ${food.name}`} onClick={() => setInput((current) => ({ ...current, pantry: current.pantry.filter((entry) => entry.ingredientId !== item.ingredientId) }))}><X size={16}/></button>
                        </div>
                        <div className="diet-line"><select aria-label={`Uso nella dieta ${food.name}`} value={item.mode} onChange={(event) => {
                          const mode = event.target.value;
                          if (mode === "available" || mode === "fixed" || mode === "preferred") updatePantry(item.ingredientId, { mode, dietGrams: mode === "available" ? undefined : item.dietGrams ?? Math.round(item.availableGrams / input.preferences.servings) });
                        }}><option value="available">A disposizione</option><option value="fixed">Grammatura bloccata</option><option value="preferred">Quantita preferita</option></select>
                          {item.mode !== "available" && <label><input aria-label={`Grammi dieta ${food.name}`} type="number" min=".1" max="5000" step=".1" value={item.dietGrams ?? ""} onChange={(event) => updatePantry(item.ingredientId, { dietGrams: Number(event.target.value) })}/><span>g / porzione</span></label>}
                        </div>
                      </div>;
                    })}
                  </div>
                  <div className="fridge-footer"><span><span className="online-dot"/>{input.pantry.length} ingredienti nel tuo frigo</span><button className="text-button" onClick={() => { setCatalogOpen(true); searchRef.current?.focus(); }}><Plus size={15}/> Aggiungi</button></div>
                  <details className="diet-import"><summary><BookOpen size={16}/> Hai gia gli alimenti della tua dieta?<ChevronDown size={15}/></summary>
                    <div className="details-body"><p>Una riga per alimento, in grammi per porzione. Esempio: <strong>150 g pollo</strong>. Riso e pasta sono pesati secchi; le verdure vanno specificate e pesate.</p><textarea aria-label="Alimenti della dieta" rows={4} placeholder={"150 g pollo\n80 g riso\n10 g olio"} value={dietText} onChange={(event) => setDietText(event.target.value)}/>
                      <label className="checkbox-row"><input type="checkbox" checked={dietConfirmed} onChange={(event) => setDietConfirmed(event.target.checked)}/><span>Confermo di avere queste quantita per tutte le {input.preferences.servings} porzioni. Le disponibilita verranno aggiornate almeno a questi valori.</span></label>
                      {dietErrors.map((error, index) => <p className="form-error" key={index}>{error}</p>)}
                      <button className="button button-secondary" onClick={importDiet}>Importa e blocca grammature</button></div>
                  </details>
                </section>}

                <section className="card preference-card">
                  <div className="section-heading"><div className="heading-with-step"><span className="section-step">02</span><div><h2>Di cosa hai voglia?</h2><p>La ricetta giusta, al momento giusto.</p></div></div><Utensils size={22} className="section-icon"/></div>
                  <div className="preference-label">IL TUO MOMENTO</div>
                  <div className="pill-group">{([["breakfast", "Colazione"], ["lunch", "Pranzo"], ["dinner", "Cena"], ["snack", "Snack"], ["dessert", "Dessert"]] as const).map(([id, label]) => <button className={`choice-pill ${input.preferences.meal === id ? "selected" : ""}`} key={id} aria-pressed={input.preferences.meal === id} onClick={() => setPreference("meal", id)}>{label}</button>)}</div>
                  <div className="preference-two-cols"><div><div className="preference-label">DOLCE O SALATO?</div><div className="segmented-control">{([["savory", "Salato"], ["sweet", "Dolce"], ["either", "Sorprendimi"]] as const).map(([id, label]) => <button key={id} className={input.preferences.taste === id ? "active" : ""} onClick={() => setPreference("taste", id)}>{label}</button>)}</div></div>
                    <div><label className="preference-label" htmlFor="max-time">TEMPO TOTALE MASSIMO</label><select id="max-time" className="field-select" value={input.preferences.maxTime} onChange={(event) => setPreference("maxTime", Number(event.target.value))}>{[10, 15, 20, 25, 30, 35, 45, 60].map((value) => <option key={value} value={value}>{value} minuti</option>)}{![10, 15, 20, 25, 30, 35, 45, 60].includes(input.preferences.maxTime) && <option value={input.preferences.maxTime}>{input.preferences.maxTime} minuti</option>}</select></div></div>
                  <div className="pill-group preference-toggles"><button className={`choice-pill ${input.preferences.highProtein ? "selected" : ""}`} aria-pressed={input.preferences.highProtein} onClick={() => setPreference("highProtein", !input.preferences.highProtein)}><Dumbbell size={15}/>Alta quota proteica</button>
                    <button className={`choice-pill ${input.preferences.vegetarian ? "selected" : ""}`} aria-pressed={input.preferences.vegetarian} onClick={() => setPreference("vegetarian", !input.preferences.vegetarian)}><Leaf size={15}/>Vegetariano</button>
                    <button className={`choice-pill ${input.preferences.mealPrep ? "selected" : ""}`} aria-pressed={input.preferences.mealPrep} onClick={() => setPreference("mealPrep", !input.preferences.mealPrep)}><CheckCheck size={15}/>Meal prep</button></div>
                  <details className="advanced-preferences"><summary><Settings2 size={16}/> Allergie, strumenti e altre preferenze<ChevronDown size={15}/></summary><div className="details-body">
                    <div className="preference-label">ALLERGENI DA ESCLUDERE</div><div className="pill-group">{ALLERGENS.map((allergen) => <button key={allergen.id} className={`choice-pill small ${input.preferences.allergens.includes(allergen.id) ? "selected-danger" : ""}`} aria-pressed={input.preferences.allergens.includes(allergen.id)} onClick={() => setPreference("allergens", input.preferences.allergens.includes(allergen.id) ? input.preferences.allergens.filter((id) => id !== allergen.id) : [...input.preferences.allergens, allergen.id])}>{allergen.label}</button>)}</div>
                    <p className="micro-copy">Le esclusioni usano i dati del catalogo. Controlla sempre etichette e tracce: l&apos;app non garantisce l&apos;assenza di contaminazione crociata.</p>
                    <div className="preference-label">STRUMENTI DISPONIBILI</div><div className="checkbox-grid">{(Object.entries(EQUIPMENT_LABELS) as [Equipment, string][]).map(([id, label]) => <label className="checkbox-row" key={id}><input type="checkbox" checked={input.preferences.equipment.includes(id)} onChange={(event) => setPreference("equipment", event.target.checked ? [...input.preferences.equipment, id] : input.preferences.equipment.filter((item) => item !== id))}/><span>{label}</span></label>)}</div>
                    <p className="micro-copy">Attrezzatura di base richiesta: bilancia, coltello, ciotola e utensili puliti. Conferma anche gli strumenti selezionati: le ricette di carne cruda richiedono un termometro alimentare.</p>
                    <div className="preference-two-cols"><label className="field">Porzioni<input aria-label="Numero porzioni" type="number" min="1" max="8" value={input.preferences.servings} onChange={(event) => setPreference("servings", Number(event.target.value))}/></label><label className="field">Difficolta<select value={input.preferences.difficulty} onChange={(event) => setPreference("difficulty", event.target.value === "medium" ? "medium" : "easy")}><option value="easy">Facile</option><option value="medium">Anche media</option></select></label></div>
                    <label className="field">Massimo di grassi aggiunti per porzione (g)<input type="number" min="0" max="50" step="1" value={input.preferences.maxAddedFatGrams} onChange={(event) => setPreference("maxAddedFatGrams", Number(event.target.value))}/></label>
                    <label className="field">Un alimento da evitare<select value="" onChange={(event) => { if (event.target.value && !input.preferences.excludedIngredientIds.includes(event.target.value)) setPreference("excludedIngredientIds", [...input.preferences.excludedIngredientIds, event.target.value]); }}><option value="">Seleziona dal catalogo</option>{INGREDIENTS.filter((food) => !input.preferences.excludedIngredientIds.includes(food.id)).map((food) => <option key={food.id} value={food.id}>{food.name}</option>)}</select></label>
                    <div className="pill-group">{input.preferences.excludedIngredientIds.map((id) => <button className="choice-pill selected-danger small" key={id} onClick={() => setPreference("excludedIngredientIds", input.preferences.excludedIngredientIds.filter((item) => item !== id))}>{getIngredient(id)?.name ?? id}<X size={12}/></button>)}</div>
                  </div></details>
                </section>
              </div>

              <aside className="workspace-right">
                <section className="card goal-card">
                  {builderMode !== "pantry" && <div className="meal-goal-intro"><LockKeyhole size={22}/><h2>Il pasto resta il tuo.</h2><p>Le grammature della dieta rimangono fisse. Pangrattato, farina e condimenti si aggiungono solo dopo la tua conferma.</p><p>Nel risultato: <strong>pasto originale + aggiunte = ricetta completa.</strong></p>
                    {(["kcal", "protein", "carbs", "fat", "fiber"] as const).some((key) => input.targets[key] !== null) && <div className="meal-active-targets"><strong>Target numerici attivi per porzione</strong><p>{(["kcal", "protein", "carbs", "fat", "fiber"] as const).filter((key) => input.targets[key] !== null).map((key) => `${NUTRIENT_LABELS[key]}: ${input.targets[key]} ${key === "kcal" ? "kcal" : "g"}`).join(" · ")}</p><button className="text-button" onClick={() => setInput((current) => ({ ...current, targets: { ...DEFAULT_MEAL_INPUT.targets } }))}>Non usare target numerici</button></div>}
                  </div>}
                  <details className={`meal-target-settings ${builderMode === "pantry" ? "classic-target-settings" : ""}`} open={builderMode === "pantry"}>
                    <summary><Settings2 size={16}/>Vuoi impostare anche i macros?<ChevronDown size={15}/></summary>
                    <div className="section-heading"><div className="heading-with-step"><span className="section-step">03</span><div><h2>Il tuo obiettivo</h2><p>{builderMode !== "pantry" ? "Facoltativo. Non cambiamo gli alimenti per raggiungerlo." : "Buona per te. Anche nei numeri."}</p></div></div></div>
                  <div className="goal-grid">{([
                    ["fat_loss", "Dimagrimento", Flame], ["muscle", "Massa muscolare", Dumbbell],
                    ["maintenance", "Mantenimento", ShieldCheck], ["balanced", "Equilibrio", Sprout],
                  ] as const).map(([id, label, Icon]) => <button key={id} className={`goal-option ${input.preferences.goal === id ? "selected" : ""}`} aria-pressed={input.preferences.goal === id} onClick={() => setPreference("goal", id)}><Icon size={21}/><span>{label}</span>{input.preferences.goal === id && <span className="goal-check"><Check size={10}/></span>}</button>)}</div>
                  <div className="target-heading"><h3>Calorie e macros</h3><span>per porzione</span></div>
                  <label className="calorie-input"><span><Flame size={19}/>Calorie target</span><div><input aria-label="Calorie target" type="number" min="1" max="3000" placeholder="Libero" value={input.targets.kcal ?? ""} onChange={(event) => setTarget("kcal", event.target.value)}/><span>kcal</span></div></label>
                  <div className="macro-inputs">{(["protein", "carbs", "fat"] as const).map((key) => <label key={key} className={`macro-input macro-${key}`}><span><i/>{NUTRIENT_LABELS[key]}</span><div><input aria-label={`${NUTRIENT_LABELS[key]} target`} type="number" min="0" max="500" step="1" placeholder="—" value={input.targets[key] ?? ""} onChange={(event) => setTarget(key, event.target.value)}/><small>g</small></div></label>)}</div>
                  <label className="fiber-input"><span><Leaf size={14}/>Fibre minime desiderate</span><div><input aria-label="Fibre minime" type="number" min="0" max="100" placeholder="Facoltative" value={input.targets.fiber ?? ""} onChange={(event) => setTarget("fiber", event.target.value)}/><small>g</small></div></label>
                  <label className="checkbox-row strict-toggle"><input type="checkbox" checked={input.targets.strictCalories} onChange={(event) => setInput((current) => ({ ...current, targets: { ...current.targets, strictCalories: event.target.checked } }))}/><span>Calorie come massimo obbligatorio</span></label>
                  <p className="micro-copy">Lascia vuoto un valore per non impostarlo. Gli obiettivi sono per il pasto, non per la giornata, e non sono una prescrizione.</p>
                  <div className="fit-promise"><ShieldCheck size={19}/><p><strong>FIT non e solo un&apos;etichetta.</strong><br/>Calcoliamo ogni ingrediente. Se un target non e raggiungibile, te lo diciamo.</p></div>
                  </details>
                </section>
                <section className="generate-card">
                  {(config?.aiTextAvailable || config?.aiImagesAvailable) && <label className="checkbox-row ai-consent"><input type="checkbox" checked={aiConsent} onChange={(event) => setAiConsent(event.target.checked)}/><span>Abilito la personalizzazione AI: ingredienti e piano saranno inviati a OpenAI. Le API sono a consumo; nessun dato di account viene incluso.</span></label>}
                  <button className="generate-button" disabled={busy || !hydrated || (builderMode !== "pantry" && mealPending) || (builderMode === "weekly" && !weeklyApplied)} onClick={() => void generate()}>{busy ? <LoaderCircle className="spin" size={21}/> : <WandSparkles size={21}/>}<span>{busy ? "Il tuo chef sta creando..." : builderMode !== "pantry" ? "Trasforma il mio pasto" : "Crea la mia ricetta FIT"}</span>{!busy && <ArrowRight size={19}/>}</button>
                  {builderMode === "weekly" && !weeklyApplied && <p className="meal-pending-note">Completa e conferma il pasto selezionato nella settimana prima di generare. I pasti liberi si compongono manualmente.</p>}
                  {builderMode === "meal" && mealPending && <p className="meal-pending-note">Conferma il testo del pasto o completa le modifiche alle quantita prima di continuare.</p>}
                  <p>Continuando, confermi ingredienti, quantita e strumenti indicati.<br/>{config?.aiTextAvailable && aiConsent ? "Creativita AI, numeri calcolati dal sistema." : "Funziona senza AI: ricette editoriali, macros calcolati."}</p>
                  {busy && <div className="generation-progress" role="status"><span/>Composizione, ottimizzazione e ricerca di nuove idee.</div>}
                </section>
                <button className="breakfast-prompt" onClick={loadBreakfast}><span className="breakfast-icon">🥞</span><span><strong>E se fosse una colazione?</strong><small>Prova un frigo dolce d&apos;esempio</small></span><ArrowRight size={17}/></button>
              </aside>
            </fieldset>
            <div className="bottom-promise"><ShieldCheck size={16}/><p>Il pasto lo decidi tu. Il gusto lo reinventiamo insieme. <button onClick={() => setInfoOpen(true)}>Scopri il metodo FIT Chef</button></p></div>
          </>}

          {view === "recipe" && currentRecipe && <RecipeView
            key={currentRecipe.id}
            recipe={currentRecipe}
            saved={workspace.favoriteIds.includes(currentRecipe.id)}
            cooked={workspace.cookedIds.includes(currentRecipe.id)}
            busy={busy || cloudBusy}
            imageBusy={imageBusy}
            canGenerateImage={Boolean(config?.aiImagesAvailable)}
            onSave={() => toggleFavorite(currentRecipe.id)}
            onCooked={() => setWorkspace((current) => ({
              ...current,
              cookedIds: current.cookedIds.includes(currentRecipe.id)
                ? current.cookedIds.filter((id) => id !== currentRecipe.id)
                : [...current.cookedIds, currentRecipe.id],
            }))}
            onBack={() => navigate("create")}
            onVariant={requestVariant}
            onSubstitute={stageSubstitution}
            onImage={() => void generateImage()}
          />}
          {(view === "favorites" || view === "history") && <section className="library-page fade-in"><span className="eyebrow">{view === "favorites" ? "DA RIFARE, QUANDO VUOI" : "OGNI PIATTO, UNA NUOVA IDEA"}</span><h1>{view === "favorites" ? "Le tue piccole ossessioni." : "Il tuo diario di cucina."}</h1><p className="library-description">{view === "favorites" ? "Le ricette che hai amato, con le loro grammature originali." : "Anche le ricette non salvate ci aiutano a non proporti sempre le stesse idee."}</p>
            {visibleRecipes.length === 0 ? <div className="empty-library"><span>{view === "favorites" ? <Heart size={33}/> : <History size={33}/>}</span><h2>{view === "favorites" ? "Il tuo ricettario aspetta il primo amore." : "La prima ricetta non si scorda mai."}</h2><p>Crea qualcosa di buono con quello che hai in frigo.</p><button className="button button-primary" onClick={() => navigate("create")}><Sparkles size={17}/>Crea una ricetta</button></div> :
              <div className="recipe-library-grid">{visibleRecipes.map((recipe) => <article className="library-card" key={recipe.id}><button className="library-visual" onClick={() => showRecipe(recipe)} aria-label={`Apri ${recipe.title}`}><FoodArt recipe={recipe} compact/><span className="library-time"><Clock3 size={13}/>{recipe.minutes} min</span></button><button className={`library-favorite ${workspace.favoriteIds.includes(recipe.id) ? "is-saved" : ""}`} onClick={() => toggleFavorite(recipe.id)} aria-label={`${workspace.favoriteIds.includes(recipe.id) ? "Rimuovi dai" : "Aggiungi ai"} preferiti: ${recipe.title}`}><Heart size={18} fill={workspace.favoriteIds.includes(recipe.id) ? "currentColor" : "none"}/></button><div className="library-card-body"><span className="recipe-category">{recipe.cuisine} · {new Date(recipe.createdAt).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}</span><button className="library-title" onClick={() => showRecipe(recipe)}>{recipe.title}</button><div className="library-macros"><span><Flame size={13}/>{formatNumber(recipe.nutritionPerServing.kcal)} kcal</span><span><Dumbbell size={13}/>{formatNumber(recipe.nutritionPerServing.protein, 1)} g proteine</span></div>{workspace.cookedIds.includes(recipe.id) && <span className="cooked-badge"><CheckCheck size={12}/>Gia cucinata</span>}</div></article>)}</div>}
          </section>}
        </main>
        <footer className="page-footer"><span>fitchef. <span>Buono, con criterio.</span></span><div><button onClick={() => setInfoOpen(true)}>Metodo e privacy</button><button onClick={exportData}>Esporta i miei dati</button><span>Versione iniziale · {INGREDIENTS.length} alimenti</span></div></footer>
      </div>
      <dialog ref={extraPromptRef} className="info-dialog chef-extra-dialog" aria-labelledby="chef-extras-title" onCancel={() => setExtraPrompt(null)}>
        {extraPrompt && <>
          <div className="modal-header"><h2 id="chef-extras-title">Prima, rendiamolo un piatto interessante.</h2><button className="icon-button" aria-label="Chiudi proposta dello chef" onClick={() => setExtraPrompt(null)}><X size={20}/></button></div>
          <ChefExtraProposal proposal={extraPrompt.proposal}/>
          <div className="chef-proposal-actions">
            <button className="button button-primary" onClick={() => {
              try {
                const approved = confirmChefExtras(extraPrompt.input, extraPrompt.proposal.extras);
                setInput(approved);
                setExtraPrompt(null);
                void generate(approved, undefined, true);
              } catch (error) {
                setExtraPrompt(null);
                setGenerationError({ message: "Rivedi le aggiunte dello chef.", details: [error instanceof Error ? error.message : "Conferma non riuscita."] });
              }
            }}>Ho questi extra, usali</button>
            <button className="button button-secondary" onClick={() => {
              setExtraPrompt(null);
              requestAnimationFrame(() => {
                const section = document.getElementById("meal-extras");
                section?.focus();
                section?.scrollIntoView({ behavior: "smooth", block: "start" });
              });
            }}>Scelgo solo gli extra che ho</button>
            <button className="text-button" onClick={() => { setExtraPrompt(null); void generate(undefined, undefined, true); }}>Continua senza aggiunte</button>
          </div>
        </>}
      </dialog>

      <dialog ref={infoRef} className="info-dialog" onCancel={() => setInfoOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setInfoOpen(false); }}>
        <div className="modal-header"><span className="brand mini-brand"><ChefHat size={22}/> fitchef.</span><button className="icon-button" onClick={() => setInfoOpen(false)} aria-label="Chiudi informazioni"><X size={20}/></button></div>
        <h2>Creativita libera.<br/>Numeri con dei limiti.</h2>
        <p>Il motore sceglie strutture culinarie compatibili e ottimizza le grammature. Calorie e macros sono calcolati dal catalogo: non vengono scritti da un modello linguistico.</p>
        <h3>Dal pasto a qualcosa di gustoso</h3><p>Nella modalita pasto gli alimenti della dieta e le loro grammature restano fissi. Confermi tu se usare piccole aggiunte, come pangrattato, farina o una salsa. Nel risultato distinguiamo sempre i nutrienti del pasto originale da quelli degli extra effettivamente utilizzati. Non compensiamo gli extra riducendo la carne o gli altri alimenti.</p>
        <h3>Una prima versione, trasparente</h3><p>Il catalogo iniziale contiene {INGREDIENTS.length} alimenti con valori medi dichiarati. Non sostituisce le etichette dei prodotti, un&apos;analisi del piatto o un professionista della nutrizione. Le immagini editoriali sono illustrazioni, non fotografie della tua ricetta.</p>
        <h3>I dati sono tuoi</h3><p>Frigo, preferenze e fino a 100 ricette rimangono in questo browser. I preferiti (massimo 50) vengono conservati prima dello storico non salvato. Il cloud e facoltativo e richiede un account configurato. La cancellazione locale non elimina copie esportate o salvate nel cloud.</p>
        <h3>AI solo se la scegli</h3><p>Senza configurazione, non viene contattato alcun servizio AI. Con API attive serve il tuo consenso prima di inviare il piano a OpenAI. Le immagini vengono richieste soltanto dopo aver definito la ricetta e possono comportare costi API.</p>
        <div className="button-row"><button className="button button-secondary" onClick={exportData}>Esporta dati</button><button className="button button-danger" onClick={clearData}><Trash2 size={16}/>Elimina dati locali</button></div>
      </dialog>
    </div>
  );
}
