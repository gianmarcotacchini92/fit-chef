export async function hashJson(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 non disponibile. Apri FIT Chef tramite HTTPS o localhost.");
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Il valore non è serializzabile in JSON.");
  const bytes = new TextEncoder().encode(serialized);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
