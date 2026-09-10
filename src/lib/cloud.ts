import { getApps, initializeApp } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence, type Auth } from "firebase/auth";
import {
  doc, getDocFromServer, getFirestore, onSnapshot, runTransaction, serverTimestamp,
  type Firestore, type Unsubscribe,
} from "firebase/firestore";
import { z } from "zod";
import { firebaseOptions } from "./firebase-config";
import { localStateSchema } from "./validation";
import type { LocalState } from "./types";

export const MAX_CLOUD_BYTES = 900 * 1024;
export const CLOUD_COLLECTION = "fitChefUsers";
export type CloudClient = { auth: Auth; db: Firestore; ready: Promise<void> };
export type CloudSnapshot = { revision: string | null; state: LocalState | null };
let browserClient: CloudClient | undefined;

export function isCloudConfigured(): boolean {
  return Boolean(firebaseOptions.apiKey && firebaseOptions.authDomain && firebaseOptions.projectId && firebaseOptions.appId);
}

export function getCloudClient(): CloudClient | null {
  if (typeof window === "undefined" || !isCloudConfigured()) return null;
  if (!browserClient) {
    const app = getApps().find((app) => app.name === "fit-chef") ?? initializeApp(firebaseOptions, "fit-chef");
    const auth = getAuth(app);
    auth.languageCode = "it";
    browserClient = { auth, db: getFirestore(app), ready: setPersistence(auth, browserLocalPersistence) };
  }
  return browserClient;
}

export function cloudErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "permission-denied") return "Firebase non autorizza l'accesso ai dati FIT Chef. Controlla le regole Firestore dedicate: i dati locali non sono stati cancellati.";
  if (code === "unavailable") return "Cloud non raggiungibile. Le modifiche restano sul dispositivo e verranno ritentate quando torna la connessione.";
  if (code === "auth/unauthorized-domain") return "Questo indirizzo non e autorizzato in Firebase Authentication. Aggiungilo ai domini autorizzati del progetto.";
  if (code === "auth/popup-blocked") return "Il browser ha bloccato la finestra Google. Consenti i popup per questo sito e premi di nuovo Accedi con Google.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "Accesso Google annullato. Nessun dato e stato caricato.";
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && error.message.trim()) return error.message;
  return "Operazione cloud non riuscita. Controlla la connessione e riprova.";
}

export function parseCloudWorkspace(payload: unknown): LocalState {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload, (_key, value: unknown) => {
      if (typeof value === "string" && /^\s*(?:data:|blob:)/i.test(value)) throw new Error("La copia cloud non accetta immagini incorporate (base64) o URL temporanei (blob).");
      return value;
    });
  } catch (error) {
    throw new Error(`Dati cloud non validi: ${cloudErrorMessage(error)}`);
  }
  if (!serialized) throw new Error("La copia cloud non contiene dati validi.");
  if (new TextEncoder().encode(serialized).byteLength > MAX_CLOUD_BYTES) throw new Error("La copia supera il limite di 900 KiB del documento Firebase. Esporta le ricette prima di ridurre lo storico; nessun dato e stato rimosso.");
  const parsed = localStateSchema.safeParse(payload);
  if (!parsed.success) throw new Error("La copia contiene dati non validi o una versione non supportata. I dati locali non sono stati modificati.");
  return parsed.data;
}

const cloudRecordSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().uuid(),
  data: z.string().max(MAX_CLOUD_BYTES),
  deleted: z.boolean(),
});

export function parseCloudRecord(value: unknown): CloudSnapshot {
  const parsed = cloudRecordSchema.safeParse(value);
  if (!parsed.success) throw new Error("Documento Firebase non valido: sincronizzazione sospesa, dati locali conservati.");
  if (parsed.data.deleted) {
    if (parsed.data.data !== "") throw new Error("Documento Firebase cancellato ma non vuoto.");
    return { revision: parsed.data.revision, state: null };
  }
  let payload: unknown;
  try { payload = JSON.parse(parsed.data.data); }
  catch { throw new Error("La copia Firebase non contiene JSON valido. Dati locali conservati."); }
  return { revision: parsed.data.revision, state: parseCloudWorkspace(payload) };
}

export class CloudConflictError extends Error {
  constructor(public readonly latest: CloudSnapshot) {
    super("I dati cloud sono cambiati su un altro dispositivo. Nessuna copia e stata sovrascritta.");
  }
}

export function assertCloudUser(client: CloudClient, uid: string): void {
  if (!uid || uid.includes("/") || client.auth.currentUser?.uid !== uid) throw new Error("L'account e cambiato: operazione interrotta senza trasferire dati tra account.");
}

export async function readCloudWorkspace(client: CloudClient, uid: string): Promise<CloudSnapshot> {
  await client.ready;
  assertCloudUser(client, uid);
  const snapshot = await getDocFromServer(doc(client.db, CLOUD_COLLECTION, uid));
  assertCloudUser(client, uid);
  return snapshot.exists() ? parseCloudRecord(snapshot.data()) : { revision: null, state: null };
}

export function watchCloudWorkspace(
  client: CloudClient, uid: string, receive: (snapshot: CloudSnapshot) => void, onError: (error: unknown) => void,
): Unsubscribe {
  assertCloudUser(client, uid);
  return onSnapshot(doc(client.db, CLOUD_COLLECTION, uid), { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
    try {
      assertCloudUser(client, uid);
      receive(snapshot.exists() ? parseCloudRecord(snapshot.data()) : { revision: null, state: null });
    } catch (error) { onError(error); }
  }, onError);
}

export async function writeCloudWorkspace(
  client: CloudClient, uid: string, state: LocalState | null, expectedRevision: string | null,
): Promise<CloudSnapshot> {
  const checked = state === null ? null : parseCloudWorkspace(state);
  await client.ready;
  assertCloudUser(client, uid);
  const revision = crypto.randomUUID();
  const reference = doc(client.db, CLOUD_COLLECTION, uid);
  await runTransaction(client.db, async (transaction) => {
    assertCloudUser(client, uid);
    const document = await transaction.get(reference);
    const current = document.exists() ? parseCloudRecord(document.data()) : { revision: null, state: null };
    if (current.revision !== expectedRevision) throw new CloudConflictError(current);
    assertCloudUser(client, uid);
    transaction.set(reference, { schemaVersion: 1, revision, data: checked === null ? "" : JSON.stringify(checked), deleted: checked === null, updatedAt: serverTimestamp() });
  });
  assertCloudUser(client, uid);
  return { revision, state: checked };
}
