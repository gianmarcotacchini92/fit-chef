import { createHash, randomBytes } from "node:crypto";
import type { Recipe } from "../types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details: string[] = [],
  ) { super(message); }
}

export const BODY_LIMIT = 128 * 1024;
export const SESSION_COOKIE = "fit_session";
const SESSION_TTL = 60 * 60 * 1_000;
const PLAN_TTL = 30 * 60 * 1_000;
const MAX_SESSIONS = 128;
type Bucket = { starts: number; count: number };
type CachedRequest = { expires: number; result: Promise<unknown> };
export type Session = {
  id: string;
  expires: number;
  busy: boolean;
  rates: Map<string, Bucket>;
  requests: Map<string, CachedRequest>;
  plans: Map<string, { recipe: Recipe; expires: number }>;
};
type Runtime = {
  sessions: Map<string, Session>;
  globalRates: Map<string, Bucket>;
  active: number;
};
const runtimeGlobal = globalThis as typeof globalThis & { __fitApiRuntime?: Runtime };
const state = runtimeGlobal.__fitApiRuntime ??= {
  sessions: new Map(), globalRates: new Map(), active: 0,
};

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase()) &&
      !url.username && !url.password;
  } catch { return false; }
}

// This MVP deliberately refuses non-loopback requests: an opaque cookie is NOT user authentication.
export function assertLocalRequest(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const authority = host === null ? url.origin : `${url.protocol}//${host}`;
  const publicUrl = isLoopbackUrl(authority) ? new URL(authority) : null;
  // NextURL rewrites 127.0.0.1 and [::1] to localhost but keeps the browser Host.
  // Only its loopback spelling may differ: validate the raw authority and preserve the port.
  if (!isLoopbackUrl(request.url) || !publicUrl ||
      (host !== null && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?$/i.test(host)) ||
      publicUrl.port !== url.port) {
    throw new ApiError(403, "Backend locale: accesso remoto disabilitato. Prima del deploy serve autenticazione server.");
  }
  const origin = request.headers.get("origin");
  if ((origin && origin !== publicUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "Origine della richiesta non autorizzata.");
  }
  return publicUrl.origin;
}

export function assertMutation(request: Request): void {
  const publicOrigin = assertLocalRequest(request);
  const origin = request.headers.get("origin");
  if (!origin || origin !== publicOrigin ||
      ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) {
    throw new ApiError(403, "Origine della richiesta non autorizzata.");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError(415, "Invia un corpo JSON.");
  }
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding !== "identity") throw new ApiError(415, "Compressione del corpo non supportata.");
}

export function hasAiConsent(request: Request): boolean {
  return request.headers.get("x-fit-ai-consent") === "true";
}

export async function readBoundedJson(request: Request, limit = BODY_LIMIT): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    throw new ApiError(413, "Richiesta troppo grande.");
  }
  if (!request.body) throw new ApiError(400, "Il corpo JSON e obbligatorio.");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      void reader.cancel().catch(() => undefined);
      reject(new ApiError(408, "Tempo massimo di lettura della richiesta superato."));
    }, 15_000);
  });
  const reading = async () => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (expired) throw new ApiError(408, "Richiesta scaduta.");
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new ApiError(413, "Richiesta troppo grande.");
        }
        chunks.push(value);
      }
      try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
      } catch {
        throw new ApiError(400, "JSON non valido.");
      }
    } finally { reader.releaseLock(); }
  };
  try { return await Promise.race([reading(), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

function cleanup(now: number): void {
  for (const [id, session] of state.sessions) {
    if (session.expires <= now && !session.busy) state.sessions.delete(id);
  }
}

export function getSession(request: Request, create = true): Session {
  const now = Date.now();
  cleanup(now);
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie.match(/(?:^|;\s*)fit_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  const found = token ? state.sessions.get(token) : undefined;
  if (found && found.expires > now) {
    found.expires = now + SESSION_TTL;
    return found;
  }
  if (!create) throw new ApiError(409, "Sessione o piano scaduto: rigenera la ricetta prima di creare l'immagine.");
  if (state.sessions.size >= MAX_SESSIONS) throw new ApiError(503, "Troppe sessioni attive. Riprova piu tardi.");
  const session: Session = {
    id: randomBytes(32).toString("hex"), expires: now + SESSION_TTL,
    busy: false, rates: new Map(), requests: new Map(), plans: new Map(),
  };
  state.sessions.set(session.id, session);
  return session;
}

export function responseJson(body: unknown, status = 200, session?: Session, request?: Request): Response {
  const headers = new Headers({
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  if (status === 429 || status === 503) headers.set("Retry-After", "60");
  if (session) headers.set("Set-Cookie",
    `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${request?.url.startsWith("https:") ? "; Secure" : ""}`);
  return Response.json(body, { status, headers });
}

export function errorResponse(error: unknown, scope: string, session?: Session, request?: Request): Response {
  if (error instanceof ApiError) {
    return responseJson({ status: "error", message: error.message, details: error.details }, error.status, session, request);
  }
  // Never log provider bodies, exception messages, request bodies or health preferences.
  console.error(`[fit-api:${scope}] unexpected_failure`);
  return responseJson({
    status: "error", message: "Errore tecnico del servizio. Riprova tra poco.",
    details: ["Nessun dettaglio sensibile e stato registrato."],
  }, 500, session, request);
}

function take(bucketMap: Map<string, Bucket>, name: string, maximum: number, windowMs: number, now: number): void {
  let bucket = bucketMap.get(name);
  if (!bucket || now - bucket.starts >= windowMs) {
    bucket = { starts: now, count: 0 };
    bucketMap.set(name, bucket);
  }
  if (bucket.count >= maximum) throw new ApiError(429, "Limite di richieste raggiunto. Riprova piu tardi.");
  bucket.count++;
}

export function rateLimit(session: Session, name: "generation" | "image" | "text"): void {
  const now = Date.now();
  if (name === "generation") {
    take(state.globalRates, name, 100, 60_000, now);
    take(session.rates, name, 20, 60_000, now);
  } else {
    // Global paid-call caps remain effective even when a caller discards cookies.
    take(state.globalRates, name, name === "image" ? 10 : 100, 24 * 60 * 60_000, now);
    take(session.rates, name, name === "image" ? 3 : 20, 60 * 60_000, now);
  }
}

export async function exclusive<T>(session: Session, action: () => Promise<T>): Promise<T> {
  if (session.busy) throw new ApiError(429, "Un'operazione e gia in corso. Attendi prima di riprovare.");
  if (state.active >= 4) throw new ApiError(503, "Servizio occupato. Riprova tra poco.");
  session.busy = true;
  state.active++;
  try { return await action(); }
  finally { session.busy = false; state.active--; }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => `${JSON.stringify(key)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function idempotencyKey(request: Request, payload: unknown, operation: string): string {
  const key = request.headers.get("idempotency-key") ?? "";
  if (key && !/^[a-zA-Z0-9_.:-]{1,128}$/.test(key)) throw new ApiError(400, "Chiave di idempotenza non valida.");
  return createHash("sha256").update(stableJson({
    operation, key, payload, consent: hasAiConsent(request),
  })).digest("hex");
}

export async function idempotent<T>(session: Session, key: string, action: () => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [oldKey, cached] of session.requests) if (cached.expires <= now) session.requests.delete(oldKey);
  const existing = session.requests.get(key);
  if (existing) return existing.result as Promise<T>;
  if (session.requests.size >= 12) session.requests.delete(session.requests.keys().next().value!);
  const result = Promise.resolve().then(action);
  session.requests.set(key, { result, expires: now + 10 * 60_000 });
  try { return await result; }
  catch (error) { session.requests.delete(key); throw error; }
}

export function rememberPlan(session: Session, recipe: Recipe): void {
  const now = Date.now();
  for (const [key, plan] of session.plans) if (plan.expires <= now) session.plans.delete(key);
  if (session.plans.size >= 10 && !session.plans.has(recipe.id)) session.plans.delete(session.plans.keys().next().value!);
  const previous = session.plans.get(recipe.id)?.recipe;
  const retained = !recipe.image && previous?.planHash === recipe.planHash && previous.image
    ? { ...recipe, image: previous.image }
    : recipe;
  session.plans.set(recipe.id, { recipe: structuredClone(retained), expires: now + PLAN_TTL });
}

export function authorizedPlan(session: Session, recipeId: string, planHash: string): Recipe {
  const plan = session.plans.get(recipeId);
  if (!plan || plan.expires <= Date.now() || plan.recipe.planHash !== planHash) {
    throw new ApiError(409, "Piano non disponibile o modificato: rigenera la ricetta prima di creare l'immagine.");
  }
  return structuredClone(plan.recipe);
}
