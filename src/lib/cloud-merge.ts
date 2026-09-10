import { localStateSchema } from "./validation";
import type { LocalState } from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (record(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

export function sameWorkspace(left: LocalState | null, right: LocalState | null): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function mergeCloudWorkspaces(base: LocalState, local: LocalState, remote: LocalState): {
  state?: LocalState; conflicts: string[];
} {
  const conflicts: string[] = [];
  const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
  function merge(before: unknown, here: unknown, there: unknown, path: string): unknown {
    if (equal(here, there)) return here;
    if (equal(here, before)) return there;
    if (equal(there, before)) return here;
    if (Array.isArray(here) && Array.isArray(there) && (before === undefined || Array.isArray(before))) {
      const previous: unknown[] = Array.isArray(before) ? before : [];
      if ([...previous, ...here, ...there].every((item) => typeof item === "string")) {
        const values = new Set([...previous, ...here, ...there]);
        return [...values].filter((value) => previous.includes(value)
          ? here.includes(value) && there.includes(value)
          : here.includes(value) || there.includes(value));
      }
      const identity = path === "input.pantry" ? "ingredientId" : path === "recipes" ? "id" : null;
      if (identity && [...previous, ...here, ...there].every((item) => record(item) && typeof item[identity] === "string")) {
        const toMap = (items: unknown[]) => Object.fromEntries(items.map((item) => {
          if (!record(item) || typeof item[identity] !== "string") throw new Error("Identificativo non valido durante l'unione.");
          return [item[identity], item];
        }));
        const merged = merge(toMap(previous), toMap(here), toMap(there), path);
        if (record(merged)) {
          const values = Object.values(merged).filter((item) => item !== undefined);
          if (path === "recipes") values.sort((a, b) =>
            record(a) && record(b) && typeof a.createdAt === "string" && typeof b.createdAt === "string"
              ? b.createdAt.localeCompare(a.createdAt) : 0);
          return values;
        }
      }
    }
    if (record(here) && record(there) && (before === undefined || record(before))) {
      const previous = record(before) ? before : {};
      const result: Record<string, unknown> = Object.create(null);
      for (const key of new Set([...Object.keys(previous), ...Object.keys(here), ...Object.keys(there)])) {
        const value = merge(previous[key], here[key], there[key], path ? `${path}.${key}` : key);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    conflicts.push(path || "workspace");
    return here;
  }
  const merged = merge(base, local, remote, "");
  if (conflicts.length) return { conflicts };
  const parsed = localStateSchema.safeParse(merged);
  if (!parsed.success) return { conflicts: ["Le due copie non possono essere unite rispettando i limiti e i riferimenti del ricettario. Scegli quale usare dopo aver esportato una copia."] };
  return { state: parsed.data, conflicts: [] };
}
