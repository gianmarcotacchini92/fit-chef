import { foodSnapshotSchema, type FoodSnapshot } from "./nutrition-diary";

export type MealProductResults = { foods: FoodSnapshot[]; message: string };
const cache = new Map<string, { at: number; result: MealProductResults }>();
let requests: number[] = [];
export function resetMealProductSearch() { cache.clear(); requests = []; }

/** Search results are choices, never automatically identified as the user's meal. */
export function parseMealProducts(value: unknown): MealProductResults {
  const products = typeof value === "object" && value !== null && "products" in value ? value.products : null;
  if (!Array.isArray(products)) throw new Error("Risposta della ricerca non valida.");
  const foods: FoodSnapshot[] = [];
  for (const p of products.slice(0, 12)) {
    if (!p || typeof p !== "object" || typeof p.code !== "string" || !/^\d{4,20}$/.test(p.code) ||
      typeof p.product_name !== "string" || !p.product_name.trim() || p.nutrition_data_per !== "100g") continue;
    const n = p.nutriments;
    if (!n || typeof n !== "object") continue;
    const keys = ["energy-kcal_100g", "proteins_100g", "carbohydrates_100g", "fat_100g", "fiber_100g"];
    if (!keys.every(k => typeof n[k] === "number" && Number.isFinite(n[k]) && n[k] >= 0)) continue;
    if (n["energy-kcal_100g"] > 1000 || keys.slice(1).some(k => n[k] > 100)) continue;
    const productName = `${p.product_name}${typeof p.brands === "string" && p.brands ? ` · ${p.brands}` : ""}`.slice(0, 160);
    const parsed = foodSnapshotSchema.safeParse({ id: `off-${p.code}`, barcode: p.code, name: productName,
      state: "prodotto confezionato, come venduto; verifica corrispondenza ed etichetta",
      source: `Open Food Facts (ODbL), dati collaborativi non verificati: https://world.openfoodfacts.org/product/${p.code}. Valori dichiarati per 100 g, non una ricetta generica.`,
      per100g: { kcal: n[keys[0]], protein: n[keys[1]], carbs: n[keys[2]], fat: n[keys[3]], fiber: n[keys[4]] },
    });
    if (parsed.success && !foods.some(f => f.id === parsed.data.id)) foods.push(parsed.data);
  }
  return { foods, message: foods.length ? "Scegli solo il prodotto effettivamente mangiato. Le confezioni trovate non equivalgono a un piatto fatto in casa." : "Nessun prodotto con dati completi per 100 g. Prova marca o nome più preciso; i valori mancanti non sono stati inventati." };
}

/** User-triggered full-text search: food query only, never diary/profile/history. */
export async function searchMealProducts(query: string, options: { signal?: AbortSignal; fetchImpl?: typeof fetch; now?: () => number } = {}): Promise<MealProductResults> {
  const q = query.trim();
  if (q.length < 3 || q.length > 100) throw new Error("Usa un nome alimento da 3 a 100 caratteri.");
  const now = (options.now ?? Date.now)();
  const key = q.toLocaleLowerCase("it");
  const found = cache.get(key);
  if (found && now - found.at < 600_000) return found.result;
  requests = requests.filter(t => now - t < 60_000);
  if (requests.length >= 5) throw new Error("Attendi un minuto prima di altre ricerche online.");
  requests.push(now);
  // OFF's documented legacy full-text endpoint; /api/v2/search does not support text queries.
  const params = new URLSearchParams({ search_terms: q, search_simple: "1", action: "process", json: "1", page_size: "12", fields: "code,product_name,brands,nutriments,nutrition_data_per", app_name: "FitChef" });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  try {
    const response = await (options.fetchImpl ?? fetch)(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new Error(`Ricerca non disponibile (HTTP ${response.status}). Riprova più tardi.`);
    if (!response.body) throw new Error("Risposta vuota dalla ricerca.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 256_000) { await reader.cancel(); throw new Error("Risposta della ricerca troppo grande."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    const result = parseMealProducts(JSON.parse(new TextDecoder().decode(data)));
    if (cache.size >= 50) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now, result });
    return result;
  } catch (error) {
    if (signal.aborted) throw new Error("Ricerca annullata o scaduta. I dati già inseriti sono conservati.");
    throw error;
  } finally { clearTimeout(timer); }
}
