import type { GenerateRequest, GenerationResponse } from "./types";

export type RecipeWorkerMessage =
  | { type: "result"; result: GenerationResponse }
  | { type: "error"; message: string };

export const BROWSER_GENERATION_TIMEOUT_MS = 120_000;

export function browserGenerateRecipe(request: GenerateRequest): Promise<GenerationResponse> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(new Error("Questo browser non supporta i Web Worker necessari per generare la ricetta."));
      return;
    }
    const asset = process.env.NEXT_PUBLIC_RECIPE_WORKER_PATH;
    if (!asset) {
      reject(new Error("Motore browser non incluso in questa build. Ricostruisci la versione statica di FIT Chef."));
      return;
    }
    const worker = new Worker(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${asset}`, {
      name: "fit-chef-recipe",
    });
    const cleanup = () => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (message: string) => {
      cleanup();
      reject(new Error(message));
    };
    const timer = setTimeout(() => {
      fail("Generazione interrotta dopo 120 secondi. Riprova con meno ingredienti o su un dispositivo più veloce; nessun vincolo è stato modificato.");
    }, BROWSER_GENERATION_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<RecipeWorkerMessage>) => {
      const message = event.data;
      if (message?.type === "error") {
        fail(message.message);
      } else if (message?.type === "result" && message.result &&
        ["ok", "needs_input", "infeasible", "error"].includes(message.result.status)) {
        cleanup();
        resolve(message.result);
      } else {
        fail("Il motore ha restituito una risposta non riconosciuta.");
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(event.message || "Impossibile avviare il motore locale. Verifica il caricamento degli asset e riprova.");
    };
    worker.onmessageerror = () => fail("Impossibile leggere il risultato del motore locale.");
    try {
      worker.postMessage(request);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
