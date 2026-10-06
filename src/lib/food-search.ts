import { INGREDIENTS } from "./catalog";
import { foodSnapshotSchema, type FoodSnapshot } from "./nutrition-diary";
import type { Ingredient, Nutrients } from "./types";

/** Diacritic-insensitive, case-insensitive normalisation for Italian search terms. */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Searches the curated catalog by name and aliases (e.g. "pollo", "chicken"). Exact and prefix matches rank first. */
export function searchCatalog(query: string, limit = 12): Ingredient[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const scored = INGREDIENTS.flatMap((ingredient) => {
    const haystacks = [ingredient.name, ...ingredient.aliases].map(normalize);
    if (!haystacks.some((text) => text.includes(normalized))) return [];
    const score = haystacks.some((text) => text === normalized) ? 0
      : haystacks.some((text) => text.startsWith(normalized)) ? 1 : 2;
    return [{ ingredient, score }];
  });
  scored.sort((left, right) => left.score - right.score || left.ingredient.name.localeCompare(right.ingredient.name, "it"));
  return scored.slice(0, limit).map((entry) => entry.ingredient);
}

/** Barcode gate: digits only, plausible EAN/UPC/GTIN length. Rejects anything that is not a bare numeric code before it ever reaches a URL. */
export function isValidBarcode(value: string): boolean {
  return /^\d{4,20}$/.test(value.trim());
}

/** Builds a FoodSnapshot for a user-entered custom food. Source is explicit about being unverified, never silently invented. */
export function manualFoodSnapshot(input: { name: string; state: string; per100g: Nutrients; barcode?: string }): FoodSnapshot {
  const name = input.name.trim();
  const state = input.state.trim();
  if (!name) throw new Error("Indica il nome dell'alimento.");
  if (!state) throw new Error("Indica lo stato dell'alimento (crudo, cotto, confezionato...).");
  const barcode = input.barcode?.trim();
  if (barcode && !isValidBarcode(barcode)) throw new Error("Il codice a barre deve contenere solo cifre.");
  const candidate = {
    id: `manual-${crypto.randomUUID()}`,
    name,
    state,
    source: "Inserito manualmente dall'utente: valori per 100 g non verificati, controlla sempre l'etichetta del prodotto.",
    per100g: input.per100g,
    ...(barcode ? { barcode } : {}),
  };
  const parsed = foodSnapshotSchema.safeParse(candidate);
  if (!parsed.success) throw new Error(`Alimento non valido: ${parsed.error.issues.map((issue) => issue.message).join(" ")}`);
  return parsed.data;
}

export type OffProduct = {
  name: string; brands: string; barcode: string;
  per100g: { kcal: number; protein: number; carbs: number; fat: number };
  fiber: number | null;
};
export type OffLookup =
  | { status: "ok"; product: OffProduct }
  | { status: "not-found"; message: string }
  | { status: "error"; message: string };

// Open Food Facts API v3.6 (current; v2 is deprecated). Read limit is 15 requests/min/IP, so stay well below it.
const OFF_ENDPOINT = "https://world.openfoodfacts.org/api/v3.6/product";
const OFF_FIELDS = "code,product_name,brands,nutrition";
const OFF_APP_NAME = "FitChef";
const OFF_CACHE_MS = 10 * 60_000;
const OFF_WINDOW_MS = 60_000;
const OFF_MAX_PER_WINDOW = 8;
const KJ_PER_KCAL = 4.184;

const offCache = new Map<string, { at: number; result: OffLookup }>();
const offInflight = new Map<string, Promise<OffLookup>>();
let offRequestTimes: number[] = [];

/** Test helper: clears the per-session cache, in-flight requests and throttle window. */
export function resetOffLookupState(): void {
  offCache.clear();
  offInflight.clear();
  offRequestTimes = [];
}

type OffNutrient = { value?: unknown; unit?: unknown; source?: unknown; source_per?: unknown };

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function nutrientValue(nutrients: Record<string, OffNutrient>, key: string): { value: number; unit: string } | null {
  const entry = nutrients[key];
  // Estimates are computed from ingredients, not declared nutrition: treat them as unknown, never as data.
  if (!entry || typeof entry !== "object" || entry.source === "estimate") return null;
  // Values declared per 100 ml (or per serving) cannot be treated as per 100 g without a density.
  if (entry.source_per !== undefined && entry.source_per !== "100g") return null;
  if (typeof entry.value !== "number" || !Number.isFinite(entry.value) || entry.value < 0) return null;
  return { value: entry.value, unit: typeof entry.unit === "string" ? entry.unit : "" };
}

function grams(nutrients: Record<string, OffNutrient>, key: string): number | null {
  const found = nutrientValue(nutrients, key);
  if (!found) return null;
  if (found.unit === "g") return found.value;
  if (found.unit === "mg") return found.value / 1000;
  return null;
}

function kcal(nutrients: Record<string, OffNutrient>): number | null {
  const direct = nutrientValue(nutrients, "energy-kcal");
  if (direct && direct.unit === "kcal") return direct.value;
  for (const key of ["energy-kj", "energy"]) {
    const kj = nutrientValue(nutrients, key);
    if (kj && kj.unit.toLowerCase() === "kj") return kj.value / KJ_PER_KCAL;
  }
  return null;
}

type OffBody = {
  status?: string;
  result?: { id?: string };
  product?: { product_name?: unknown; brands?: unknown; nutrition?: { aggregated_set?: { per?: unknown; preparation?: unknown; nutrients?: Record<string, OffNutrient> } } };
};

function parseOffBody(body: OffBody, barcode: string): OffLookup {
  if (body.result?.id === "product_not_found") return { status: "not-found", message: "Nessun prodotto trovato per questo codice a barre su Open Food Facts." };
  if (body.status !== "success" || !body.product) return { status: "error", message: "Risposta di Open Food Facts non valida o prodotto non disponibile." };
  const set = body.product.nutrition?.aggregated_set;
  if (!set?.nutrients) return { status: "error", message: "Dati nutrizionali non disponibili su Open Food Facts per questo prodotto: inseriscili a mano dall'etichetta." };
  if (set.per !== "100g") return { status: "error", message: "I valori di questo prodotto non sono espressi per 100 g (ad esempio per 100 ml o per porzione): senza la densita non posso convertirli. Inseriscili a mano dall'etichetta." };
  if (set.preparation !== undefined && set.preparation !== "as_sold") return { status: "error", message: "I valori di questo prodotto riguardano il prodotto preparato, non come venduto: inseriscili a mano per evitare errori." };
  const nutrients = set.nutrients;
  const energy = kcal(nutrients);
  const protein = grams(nutrients, "proteins");
  const carbs = grams(nutrients, "carbohydrates");
  const fat = grams(nutrients, "fat");
  if (energy === null || protein === null || carbs === null || fat === null) {
    return { status: "error", message: "Dati essenziali mancanti su Open Food Facts: energia, proteine, carboidrati o grassi non dichiarati per 100 g. Inseriscili a mano dall'etichetta." };
  }
  const fiber = grams(nutrients, "fiber");
  const name = typeof body.product.product_name === "string" && body.product.product_name.trim() ? body.product.product_name.trim() : "Prodotto senza nome su Open Food Facts";
  const brands = typeof body.product.brands === "string" ? body.product.brands.trim() : "";
  return {
    status: "ok",
    product: {
      name, brands, barcode,
      per100g: { kcal: round2(energy), protein: round2(protein), carbs: round2(carbs), fat: round2(fat) },
      fiber: fiber === null ? null : round2(fiber),
    },
  };
}

type OffOptions = { signal?: AbortSignal; timeoutMs?: number; fetchImpl?: typeof fetch; now?: () => number };

/**
 * Looks up one exact barcode on the Open Food Facts v3.6 product endpoint (ODbL data). Only the barcode, the field
 * list and the app name are sent: no body, health or personal data, and no custom headers (User-Agent is a forbidden
 * browser header, so the documented app_name query parameter identifies the app). Results are cached for the session,
 * identical concurrent lookups are shared and requests are throttled below the 15/min/IP read limit. Missing
 * essential nutrients are reported as an error and fibre is null when undeclared: never defaulted to zero.
 */
export async function fetchOffProduct(barcode: string, options: OffOptions = {}): Promise<OffLookup> {
  const code = barcode.trim();
  if (!isValidBarcode(code)) return { status: "error", message: "Codice a barre non valido: solo cifre, da 4 a 20 caratteri." };
  const now = options.now ?? Date.now;
  const cached = offCache.get(code);
  if (cached && now() - cached.at < OFF_CACHE_MS) return cached.result;
  const pending = offInflight.get(code);
  if (pending) return pending;
  offRequestTimes = offRequestTimes.filter((time) => now() - time < OFF_WINDOW_MS);
  if (offRequestTimes.length >= OFF_MAX_PER_WINDOW) {
    const wait = Math.max(1, Math.ceil((OFF_WINDOW_MS - (now() - offRequestTimes[0])) / 1000));
    return { status: "error", message: `Troppe ricerche ravvicinate: Open Food Facts limita le richieste. Riprova tra circa ${wait} secondi o inserisci i valori a mano.` };
  }
  offRequestTimes.push(now());
  const request = requestOff(code, options).then((result) => {
    // Transient failures are not cached so the user can retry once the network is back.
    if (result.status !== "error") offCache.set(code, { at: now(), result });
    return result;
  }).finally(() => offInflight.delete(code));
  offInflight.set(code, request);
  return request;
}

async function requestOff(code: string, options: OffOptions): Promise<OffLookup> {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), options.timeoutMs ?? 10_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutController.signal]) : timeoutController.signal;
  try {
    const url = `${OFF_ENDPOINT}/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}&app_name=${OFF_APP_NAME}`;
    const response = await doFetch(url, { signal });
    let body: OffBody | null = null;
    try { body = await response.json() as OffBody; } catch { body = null; }
    if (response.status === 404 && body?.result?.id === "product_not_found") return parseOffBody(body, code);
    if (!response.ok) return { status: "error", message: `Open Food Facts non raggiungibile (codice ${response.status}).` };
    if (!body) return { status: "error", message: "Risposta di Open Food Facts non leggibile." };
    return parseOffBody(body, code);
  } catch {
    return { status: "error", message: "Richiesta a Open Food Facts non riuscita, scaduta o annullata: controlla la connessione e riprova." };
  } finally {
    clearTimeout(timeout);
  }
}
