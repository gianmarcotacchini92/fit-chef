import { z } from "zod";
import type { Recipe } from "../types";
import { ApiError } from "./security";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const modelName = /^[a-zA-Z0-9_.-]{1,100}$/;

export function aiConfiguration(env: Readonly<Record<string, string | undefined>> = process.env) {
  const textModel = env.OPENAI_TEXT_MODEL?.trim() || "gpt-5-mini";
  const imageModel = env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1-mini";
  const enabled = env.FIT_ENABLE_AI === "true" && Boolean(env.OPENAI_API_KEY?.trim());
  return {
    aiTextAvailable: enabled && modelName.test(textModel),
    aiImagesAvailable: enabled && modelName.test(imageModel),
    textModel,
    imageModel,
  };
}

export function approvedCopy(recipe: Recipe): { titles: string[]; descriptions: string[] } {
  const baseTitle = recipe.title.slice(0, 125);
  return {
    titles: [
      baseTitle,
      `${baseTitle} - a modo nostro`,
      `${baseTitle} - in cucina oggi`,
    ],
    descriptions: [
      recipe.description.slice(0, 1_300),
      `${recipe.description.slice(0, 1_250)} Un'idea da portare in tavola.`,
      `${recipe.description.slice(0, 1_250)} Una proposta per la tua cucina.`,
    ],
  };
}

// The model selects vetted wording; it cannot invent foods, nutrient claims or medical advice.
export function validateCreativeCopy(value: unknown, recipe: Recipe): { title: string; description: string } {
  const parsed = z.strictObject({
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(1_500),
  }).parse(value);
  const choices = approvedCopy(recipe);
  if (!choices.titles.includes(parsed.title) || !choices.descriptions.includes(parsed.description)) {
    throw new ApiError(502, "Il servizio AI ha proposto un testo non approvato.");
  }
  return parsed;
}

export function creativeJsonSchema(recipe: Recipe) {
  const choices = approvedCopy(recipe);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string", enum: choices.titles },
      description: { type: "string", enum: choices.descriptions },
    },
    required: ["title", "description"],
  };
}

export function applyCreativeCopy(recipe: Recipe, value: unknown): Recipe {
  const copy = validateCreativeCopy(value, recipe);
  return { ...structuredClone(recipe), ...copy, sourceMode: "ai" };
}

export function buildImagePrompt(recipe: Recipe): string {
  const ingredients = recipe.ingredients.map((item) =>
    `${item.name}, ${item.grams} g total, state: ${item.state}`).join("; ");
  return [
    "Create one realistic editorial food photograph of the finished recipe on a simple plate.",
    `Cooking method: ${recipe.technique}. Recipe family: ${recipe.family}.`,
    `The listed quantities make ${recipe.servings} serving(s); show exactly one serving.`,
    `Only ingredients in this authoritative plan may appear: ${ingredients}.`,
    "Show the ingredients as prepared by this method, not raw packaging.",
    "Do not add herbs, sauces, seeds, fruit, oil, side dishes or decorative edible garnishes unless listed.",
    "No labels, text, people, logos, nutritional numbers or health claims. Neutral background, natural light.",
    "This is an illustrative serving suggestion, not photographic proof of exact quantities.",
  ].join("\n");
}

async function providerJson(path: string, body: unknown, timeoutMs: number, byteLimit: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.openai.com/v1/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY?.trim() ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError(502, "Il servizio AI non e disponibile. Nessuna risposta AI utilizzata.");
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json") || !response.body) {
      await response.body?.cancel();
      throw new ApiError(502, "Formato della risposta AI non valido.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > byteLimit) {
          await reader.cancel();
          throw new ApiError(502, "Risposta AI troppo grande.");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new ApiError(502, "JSON della risposta AI non valido."); }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, controller.signal.aborted
      ? "Il servizio AI ha superato il tempo massimo. Riprova piu tardi."
      : "Connessione al servizio AI non riuscita.");
  } finally { clearTimeout(timer); }
}

const completionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.literal("stop"),
    message: z.object({
      content: z.string().min(1).max(8_000),
      refusal: z.string().nullable().optional(),
    }),
  })).length(1),
});

export function parseTextResponse(response: unknown, recipe: Recipe): Recipe {
  const parsed = completionSchema.safeParse(response);
  if (!parsed.success || parsed.data.choices[0].message.refusal) {
    throw new ApiError(502, "Il servizio AI non ha restituito un testo completo e valido.");
  }
  let copy: unknown;
  try { copy = JSON.parse(parsed.data.choices[0].message.content); }
  catch { throw new ApiError(502, "Il servizio AI ha restituito testo non strutturato."); }
  return applyCreativeCopy(recipe, copy);
}

export async function enrichRecipe(recipe: Recipe): Promise<Recipe> {
  const config = aiConfiguration();
  if (!config.aiTextAvailable) return recipe;
  const response = await providerJson("chat/completions", {
    model: config.textModel,
    messages: [
      {
        role: "system",
        content: "Select one title and one description from the exact allowed JSON schema values. Never change the wording. Return only the JSON object.",
      },
      {
        role: "user",
        content: JSON.stringify(approvedCopy(recipe)),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "recipe_editorial_copy", strict: true, schema: creativeJsonSchema(recipe) },
    },
    max_completion_tokens: 2_000,
    store: false,
  }, 20_000, 64 * 1024);
  return parseTextResponse(response, recipe);
}

export function decodeImageResponse(value: unknown): Buffer {
  const parsed = z.object({
    data: z.array(z.object({
      b64_json: z.string().min(24).max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })).length(1),
  }).safeParse(value);
  if (!parsed.success) throw new ApiError(502, "Il servizio AI non ha restituito un'immagine valida.");
  const encoded = parsed.data.data[0].b64_json;
  const image = Buffer.from(encoded, "base64");
  if (image.length > MAX_IMAGE_BYTES || image.toString("base64") !== encoded ||
      image.subarray(0, 4).toString("ascii") !== "RIFF" ||
      image.subarray(8, 12).toString("ascii") !== "WEBP" ||
      !["VP8 ", "VP8L", "VP8X"].includes(image.subarray(12, 16).toString("ascii")) ||
      image.readUInt32LE(4) + 8 !== image.length) {
    throw new ApiError(502, "L'immagine ricevuta non e un file WebP valido.");
  }
  return image;
}

export async function generateImage(recipe: Recipe): Promise<Buffer> {
  const config = aiConfiguration();
  if (!config.aiImagesAvailable) throw new ApiError(503, "Immagini AI disattivate: configura esplicitamente il servizio.");
  return decodeImageResponse(await providerJson("images/generations", {
    model: config.imageModel,
    prompt: buildImagePrompt(recipe),
    n: 1,
    size: "1024x1024",
    quality: "low",
    output_format: "webp",
  }, 90_000, 12 * 1024 * 1024));
}
