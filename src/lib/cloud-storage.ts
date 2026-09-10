import { z } from "zod";
import { parseCloudWorkspace, type CloudSnapshot } from "./cloud";
import type { LocalState } from "./types";

const ownerKey = "fit-chef.firebase-owner.v1";
const baselinePrefix = "fit-chef.firebase-baseline.v1.";
const backupPrefix = "fit-chef.cloud-backup.v1.";
const baselineSchema = z.strictObject({
  uid: z.string().min(1).max(300),
  revision: z.string().uuid().nullable(),
  state: z.unknown(),
});
type StoragePort = Pick<Storage, "getItem" | "setItem" | "key" | "length">;

export function loadCloudBaseline(storage: StoragePort, account: string): CloudSnapshot | undefined {
  if (storage.getItem(ownerKey) !== account) return undefined;
  const raw = storage.getItem(`${baselinePrefix}${account}`);
  if (!raw) return undefined;
  if (raw.length > 2_000_000) throw new Error("Metadati cloud locali troppo grandi. Esporta i dati prima di ripristinare il collegamento.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("Metadati cloud locali danneggiati: non vengono sovrascritti automaticamente."); }
  const result = baselineSchema.safeParse(parsed);
  if (!result.success || result.data.uid !== account) throw new Error("Collegamento cloud locale non valido. Nessun dato e stato caricato.");
  return { revision: result.data.revision, state: result.data.state === null ? null : parseCloudWorkspace(result.data.state) };
}

export function rememberCloudBaseline(storage: StoragePort, account: string, snapshot: CloudSnapshot): void {
  storage.setItem(`${baselinePrefix}${account}`, JSON.stringify({ uid: account, ...snapshot }));
  storage.setItem(ownerKey, account);
}

export function clearCloudBinding(storage: Pick<Storage, "removeItem" | "key" | "length">): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(baselinePrefix)) keys.push(key);
  }
  storage.removeItem(ownerKey);
  for (const key of keys) storage.removeItem(key);
}

export function backupCloudWorkspace(storage: StoragePort, state: LocalState): string {
  const key = `${backupPrefix}${Date.now()}-${crypto.randomUUID()}`;
  storage.setItem(key, JSON.stringify(parseCloudWorkspace(state)));
  return key;
}

export function cloudBackups(storage: StoragePort): { key: string; state: LocalState }[] {
  const result: { key: string; state: LocalState }[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(backupPrefix)) continue;
    const raw = storage.getItem(key);
    if (!raw) throw new Error("Una copia di sicurezza locale non e leggibile.");
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error("Una copia di sicurezza locale contiene dati danneggiati."); }
    result.push({ key, state: parseCloudWorkspace(parsed) });
  }
  return result;
}
