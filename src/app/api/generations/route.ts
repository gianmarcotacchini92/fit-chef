import { generateRecipe } from "@/lib/engine";
import { generationRequestSchema, recipeSchema } from "@/lib/validation";
import type { GenerationResponse } from "@/lib/types";
import { aiConfiguration, enrichRecipe } from "@/lib/server/ai";
import {
  ApiError, assertMutation, errorResponse, exclusive, getSession, hasAiConsent,
  idempotencyKey, idempotent, rateLimit, readBoundedJson, rememberPlan, responseJson,
  type Session,
} from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let session: Session | undefined;
  try {
    assertMutation(request);
    const parsed = generationRequestSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) throw new ApiError(400, "Controlla i dati inseriti.", parsed.error.issues.slice(0, 12).map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    ));
    session = getSession(request);
    rateLimit(session, "generation");
    const owner = session;
    const key = idempotencyKey(request, parsed.data, "generation");
    const result = await idempotent<GenerationResponse>(owner, key, () => exclusive(owner, async () => {
      const generated = await generateRecipe(parsed.data);
      if (generated.status !== "ok") return generated;
      let recipe = recipeSchema.parse(generated.recipe);
      if (hasAiConsent(request) && aiConfiguration().aiTextAvailable) {
        try {
          rateLimit(owner, "text");
          recipe = recipeSchema.parse(await enrichRecipe(recipe));
        } catch {
          console.warn("[fit-api:text] enrichment_unavailable");
          recipe = {
            ...recipe, sourceMode: "editorial",
            warnings: [...recipe.warnings.slice(0, 29),
              "Testo AI non disponibile o limite raggiunto: ricetta editoriale completa, senza modifiche a dosi e calcoli."],
          };
        }
      }
      rememberPlan(owner, recipe);
      return { status: "ok", recipe };
    }));
    // A cached response also restores an evicted plan without another solver or paid call.
    if (result.status === "ok") rememberPlan(owner, result.recipe);
    return responseJson(result, result.status === "error" ? 500 : 200, owner, request);
  } catch (error) { return errorResponse(error, "generation", session, request); }
}
