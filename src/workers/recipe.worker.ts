import { generateRecipe } from "../lib/engine";
import type { RecipeWorkerMessage } from "../lib/browser-generation";
import type { GenerateRequest } from "../lib/types";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<GenerateRequest>) => void) | null;
  postMessage: (message: RecipeWorkerMessage) => void;
};

worker.onmessage = async (event) => {
  worker.onmessage = null;
  try {
    worker.postMessage({ type: "result", result: await generateRecipe(event.data) });
  } catch (error) {
    worker.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Errore inatteso del motore locale.",
    });
  }
};
