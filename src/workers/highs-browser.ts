import type highsLoader from "highs";

type HighsWorker = {
  location: Location;
  importScripts: (...urls: string[]) => void;
  Module?: typeof highsLoader;
};

// Build-time alias for "highs": keep its Node-only require branches out of the worker bundle.
const loadHighs: typeof highsLoader = (options) => {
  const worker = globalThis as unknown as HighsWorker;
  if (typeof worker.importScripts !== "function") {
    throw new Error("HiGHS browser deve essere eseguito in un Web Worker classico.");
  }
  if (!worker.Module) worker.importScripts(new URL("./highs.js", worker.location.href).href);
  if (!worker.Module) throw new Error("Caricamento del modulo HiGHS locale non riuscito.");
  return worker.Module({
    ...options,
    locateFile: (file: string) => new URL(file, worker.location.href).href,
  });
};

export default loadHighs;
