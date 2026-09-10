import { imageRequestSchema } from "@/lib/validation";
import { aiConfiguration, generateImage } from "@/lib/server/ai";
import { ensureImageCapacity, saveImage } from "@/lib/server/images";
import {
  ApiError, assertMutation, authorizedPlan, errorResponse, exclusive, getSession, hasAiConsent,
  idempotencyKey, idempotent, rateLimit, readBoundedJson, rememberPlan, responseJson,
  type Session,
} from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  let session: Session | undefined;
  try {
    assertMutation(request);
    if (!hasAiConsent(request)) throw new ApiError(403, "Per creare un'immagine serve il consenso esplicito all'AI.");
    const parsed = imageRequestSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) throw new ApiError(400, "Invia recipeId e planHash validi.");
    session = getSession(request, false);
    const owner = session;
    const recipe = authorizedPlan(owner, parsed.data.recipeId, parsed.data.planHash);
    if (recipe.image) return responseJson({ status: "ok", image: recipe.image }, 200, owner, request);
    if (!aiConfiguration().aiImagesAvailable) throw new ApiError(503, "Immagini AI disattivate. Nessuna chiamata esterna eseguita.");
    const key = idempotencyKey(request, parsed.data, "image");
    const result = await idempotent(owner, key, () => exclusive(owner, async () => {
      // The body supplies only lookup keys; all prompt content comes from the cached server plan.
      const authoritative = authorizedPlan(owner, parsed.data.recipeId, parsed.data.planHash);
      if (authoritative.image) return { status: "ok" as const, image: authoritative.image };
      await ensureImageCapacity();
      rateLimit(owner, "image");
      const url = await saveImage(await generateImage(authoritative));
      const image = { url, kind: "ai" as const, planHash: authoritative.planHash };
      rememberPlan(owner, { ...authoritative, image });
      return { status: "ok" as const, image };
    }));
    return responseJson(result, 200, owner, request);
  } catch (error) { return errorResponse(error, "image", session, request); }
}
